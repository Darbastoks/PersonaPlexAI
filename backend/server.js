const express = require('express');
const cors = require('cors');
const compression = require('compression');
const nodemailer = require('nodemailer');
const { exec } = require('child_process');
const util = require('util');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
require('dotenv').config();

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || 'sk_test_mock');

const execPromise = util.promisify(exec);
const app = express();

// ── Middleware ──────────────────────────────────────────────────
app.use(compression());
app.use(cors({ origin: '*' })); // Allow all origins for the embeddable widget
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Latency marker
app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ns = Number(process.hrtime.bigint() - start);
    const ms = (ns / 1e6).toFixed(2);
    console.log(`${req.method} ${req.url} - ${ms}ms`);
  });
  next();
});

// ── LRU Cache ──────────────────────────────────────────────────
class LRUCache {
  constructor(max = 100) {
    this.max = max;
    this.cache = new Map();
  }
  get(key) {
    if (!this.cache.has(key)) return null;
    const val = this.cache.get(key);
    this.cache.delete(key);
    this.cache.set(key, val);
    return val;
  }
  set(key, val) {
    if (this.cache.has(key)) this.cache.delete(key);
    else if (this.cache.size >= this.max) {
      this.cache.delete(this.cache.keys().next().value);
    }
    this.cache.set(key, val);
  }
}
const replyCache = new LRUCache(200);

// ── Leads & Chat Logs Storage ──────────────────────────────────
const leadsFile = path.join(__dirname, 'leads.json');
const chatLogsFile = path.join(__dirname, 'chat-logs.json');
if (!fs.existsSync(leadsFile)) fs.writeFileSync(leadsFile, JSON.stringify([]));
if (!fs.existsSync(chatLogsFile)) fs.writeFileSync(chatLogsFile, JSON.stringify([]));

// ── Groq LLM ──────────────────────────────────────────────────
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';

const DEFAULT_SYSTEM_PROMPT = `You are an AI chatbot assistant for a local business. Your goals:
1. Answer questions about the business helpfully and concisely (1-2 sentences max)
2. ALWAYS try to capture the visitor's contact info naturally. After answering 2-3 questions, say something like "I'd love to help further! Can I get your name and best phone number or email so we can follow up?"
3. If they want to schedule/book, say: "I'd love to set that up for you! Can I get your name, phone number, and preferred date/time? Our team will confirm within an hour."
4. If they share contact info (name, email, phone), acknowledge it warmly and say their info has been noted
5. Be warm, professional, and concise. Never make up information you don't have.
6. If asked about something you don't know, say "Great question! Let me get someone from our team to help with that. Can I get your name and number so they can reach you?"
Remember: Your #1 job is capturing leads, #2 is answering questions.`;

async function callGroq(userMessage, history = [], customPrompt = null) {
  const systemPrompt = customPrompt || DEFAULT_SYSTEM_PROMPT;
  const payload = JSON.stringify({
    model: 'llama-3.3-70b-versatile',
    messages: [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'user', content: userMessage }
    ],
    temperature: 0.7,
    max_tokens: 150
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.groq.com',
      path: '/openai/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          if (j.choices && j.choices[0]) {
            resolve(j.choices[0].message.content.trim());
          } else {
            reject(new Error('Invalid Groq Response'));
          }
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ── Fallback: GPT4Free ─────────────────────────────────────────
async function callG4F(userMessage) {
  const { stdout } = await execPromise(`python llm.py "${userMessage.replace(/"/g, "'")}"`, { cwd: __dirname });
  return stdout.trim().replace(/g4f is up-to-date.*?[\r\n]+/g, '').trim();
}

// ── TTS ────────────────────────────────────────────────────────
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY || '';

async function generateTTS(text) {
  if (!DEEPGRAM_API_KEY || DEEPGRAM_API_KEY.length < 10) return null; // Fallback to browser TTS

  const payload = JSON.stringify({ text });

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.deepgram.com',
      path: '/v1/speak?model=aura-asteria-en&encoding=mp3', // Lightning-fast female voice
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Token ${DEEPGRAM_API_KEY}`,
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      if (res.statusCode !== 200) {
        console.error('Deepgram TTS failed with status: ' + res.statusCode);
        return resolve(null); // Safely fallback if Deepgram fails or rate limits
      }
      
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const audioBuffer = Buffer.concat(chunks);
        resolve(audioBuffer.toString('base64')); // Send instantly to frontend!
      });
    });

    req.on('error', (err) => {
      console.error('Deepgram Network Error:', err);
      resolve(null);
    });

    req.write(payload);
    req.end();
  });
}

const stats = { totalRequests: 0, avgLlmMs: 0, avgTtsMs: 0, cacheHits: 0 };

app.post('/api/chat', async (req, res) => {
  const started = Date.now();
  try {
    const { message, history = [], systemPrompt } = req.body;
    if (!message) return res.status(400).json({ error: 'No message' });

    stats.totalRequests++;
    
    // Only cache pure zero-history queries
    if (history.length === 0 && !systemPrompt) {
      const cached = replyCache.get(message.toLowerCase().trim());
      if (cached) {
        stats.cacheHits++;
        return res.json({ ...cached, cached: true, latencyMs: Date.now() - started });
      }
    }

    if (!GROQ_API_KEY || GROQ_API_KEY.length < 10) {
      return res.status(500).json({ error: 'Missing GROQ_API_KEY environment variable on Render!' });
    }

    const aiReply = await callGroq(message, history, systemPrompt || null);
    const audio64 = await generateTTS(aiReply);
    const resp = { reply: aiReply, audioBase64: audio64, latencyMs: Date.now() - started };

    if (!systemPrompt) {
      replyCache.set(message.toLowerCase().trim(), { reply: aiReply, audioBase64: audio64 });
    }
    res.json(resp);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed' });
  }
});

// ── Lead Capture (saves lead + emails BOTH you and the client) ──────────
app.post('/api/lead-capture', async (req, res) => {
  try {
    const { name, email, phone, message, businessName, source, clientKey, clientEmail } = req.body;
    if (!name && !email && !phone) return res.status(400).json({ error: 'No contact info' });

    const lead = {
      name: name || 'Unknown',
      email: email || '',
      phone: phone || '',
      message: message || '',
      businessName: businessName || 'Website Visitor',
      source: source || 'chatbot',
      clientKey: clientKey || 'default',
      timestamp: new Date().toISOString()
    };

    // Save to file
    const leads = JSON.parse(fs.readFileSync(leadsFile));
    leads.push(lead);
    fs.writeFileSync(leadsFile, JSON.stringify(leads, null, 2));
    console.log(`📩 New lead captured: ${lead.name} (${lead.email || lead.phone}) for ${lead.businessName}`);

    const leadEmailHtml = `
      <div style="font-family: -apple-system, sans-serif; padding: 24px; background: #111; color: #fff; border-radius: 12px; max-width: 500px;">
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 16px;">
          <div style="width: 8px; height: 8px; background: #00d47e; border-radius: 50%;"></div>
          <span style="font-weight: 700;">ChatVora</span>
        </div>
        <h2 style="color: #00d47e; margin-bottom: 16px;">🔔 New Lead from Your Chatbot!</h2>
        <div style="background: #1a1a1a; padding: 16px; border-radius: 8px; border: 1px solid #333;">
          <p style="margin: 6px 0;"><strong style="color: #ccc;">Name:</strong> <span style="color: #fff;">${lead.name}</span></p>
          ${lead.email ? `<p style="margin: 6px 0;"><strong style="color: #ccc;">Email:</strong> <span style="color: #fff;">${lead.email}</span></p>` : ''}
          ${lead.phone ? `<p style="margin: 6px 0;"><strong style="color: #ccc;">Phone:</strong> <span style="color: #fff;">${lead.phone}</span></p>` : ''}
          ${lead.message ? `<p style="margin: 6px 0;"><strong style="color: #ccc;">What they need:</strong> <span style="color: #fff;">${lead.message}</span></p>` : ''}
        </div>
        <p style="color: #888; font-size: 13px; margin-top: 16px;">⏰ ${new Date().toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
        <p style="color: #888; font-size: 13px;">💡 <strong>Tip:</strong> Follow up within 5 minutes — you're 21x more likely to convert this lead.</p>
        <hr style="border: 1px solid #222; margin: 16px 0;">
        <p style="color: #555; font-size: 11px;">Captured by ChatVora AI chatbot on ${lead.businessName}</p>
      </div>
    `;

    // Email notification to ChatVora owner (you)
    try {
      const ownerEmail = process.env.SENDER_EMAIL;
      if (ownerEmail) {
        await transporter.sendMail({
          from: `"ChatVora Leads" <${ownerEmail}>`,
          to: ownerEmail,
          subject: `🔔 New Lead: ${lead.name} — ${lead.businessName}`,
          html: leadEmailHtml
        });
      }
    } catch (emailErr) {
      console.error('Owner notification email failed:', emailErr.message);
    }

    // Email notification to the CLIENT (business owner)
    try {
      if (clientEmail && clientEmail.includes('@')) {
        const ownerEmail = process.env.SENDER_EMAIL;
        await transporter.sendMail({
          from: `"ChatVora AI" <${ownerEmail}>`,
          to: clientEmail,
          subject: `🔔 New Lead: ${lead.name} — Your AI chatbot just captured a lead!`,
          html: leadEmailHtml
        });
        console.log(`📧 Lead email sent to client: ${clientEmail}`);
      }
    } catch (emailErr) {
      console.error('Client notification email failed:', emailErr.message);
    }

    res.json({ success: true });
  } catch (e) {
    console.error('Lead capture error:', e);
    res.status(500).json({ error: 'Failed to save lead' });
  }
});

// ── Chat Log ──────────────────────────────────────────────────
app.post('/api/chat-log', (req, res) => {
  try {
    const { messages, businessName, sessionId } = req.body;
    const log = {
      sessionId: sessionId || Date.now().toString(),
      businessName: businessName || 'Unknown',
      messages: messages || [],
      timestamp: new Date().toISOString()
    };
    const logs = JSON.parse(fs.readFileSync(chatLogsFile));
    logs.push(log);
    if (logs.length > 500) logs.splice(0, logs.length - 500);
    fs.writeFileSync(chatLogsFile, JSON.stringify(logs, null, 2));
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed' });
  }
});

// ── Get Leads (filtered by client key for dashboard) ──────────
app.get('/api/leads', (req, res) => {
  try {
    const key = req.query.key;
    const leads = JSON.parse(fs.readFileSync(leadsFile));
    
    if (key) {
      // Filter leads for this specific client
      const clientLeads = leads.filter(l => l.clientKey === key || key === process.env.ADMIN_KEY);
      if (clientLeads.length === 0 && key !== process.env.ADMIN_KEY && key !== 'default') {
        // Check if the key exists in customers
        const customers = JSON.parse(fs.readFileSync(customersFile));
        const validClient = customers.find(c => c.dashboardKey === key);
        if (!validClient && key !== 'default') {
          return res.status(403).json({ error: 'Invalid key' });
        }
      }
      return res.json(clientLeads.reverse());
    }
    
    // No key = return all (admin)
    res.json(leads.reverse());
  } catch (e) {
    res.json([]);
  }
});
// ── Demo Chat (Custom System Prompt for Demo Page) ──────────────
app.post('/api/demo-chat', async (req, res) => {
  try {
    const { message, systemPrompt, history = [] } = req.body;
    if (!message) return res.status(400).json({ error: 'No message' });
    if (!GROQ_API_KEY || GROQ_API_KEY.length < 10) {
      console.error('Demo chat: GROQ_API_KEY missing or too short');
      return res.status(500).json({ error: 'AI not configured' });
    }

    // Call Groq directly using the existing callGroq-style approach
    const sysMsg = systemPrompt || 'You are a helpful AI assistant. Be friendly and concise.';
    const allMessages = [
      { role: 'system', content: sysMsg },
      ...history.slice(-6),
      { role: 'user', content: message }
    ];

    const payload = JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: allMessages,
      temperature: 0.7,
      max_tokens: 150
    });

    const reply = await new Promise((resolve, reject) => {
      const apiReq = https.request({
        hostname: 'api.groq.com',
        path: '/openai/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${GROQ_API_KEY}`,
          'Content-Length': Buffer.byteLength(payload)
        }
      }, (apiRes) => {
        let data = '';
        apiRes.on('data', c => (data += c));
        apiRes.on('end', () => {
          try {
            const j = JSON.parse(data);
            if (j.choices && j.choices[0]) {
              resolve(j.choices[0].message.content.trim());
            } else {
              console.error('Demo chat Groq unexpected response:', JSON.stringify(j).substring(0, 500));
              reject(new Error('Groq returned no choices: ' + (j.error?.message || 'unknown')));
            }
          } catch (e) {
            console.error('Demo chat Groq parse error:', data.substring(0, 500));
            reject(e);
          }
        });
      });
      apiReq.on('error', (err) => {
        console.error('Demo chat network error:', err.message);
        reject(err);
      });
      apiReq.write(payload);
      apiReq.end();
    });

    // Generate TTS audio for voice playback
    const audio64 = await generateTTS(reply);

    res.json({ reply, audioBase64: audio64 });
  } catch (e) {
    console.error('Demo chat error:', e.message);
    res.status(500).json({ error: e.message || 'AI error' });
  }
});

// ── Email Configuration ─────────────────────────────────────────
const transporter = nodemailer.createTransport({
  service: 'gmail', // or your provider
  auth: {
    user: process.env.SENDER_EMAIL,
    pass: process.env.SENDER_PASSWORD // Use "App Password" for Gmail
  }
});

const customersFile = path.join(__dirname, 'customers.json');

// Ensure customers file exists
if (!fs.existsSync(customersFile)) fs.writeFileSync(customersFile, JSON.stringify([]));

// Generate a unique dashboard key for each client
const generateDashboardKey = () => {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let key = 'cv_';
  for (let i = 0; i < 12; i++) key += chars[Math.floor(Math.random() * chars.length)];
  return key;
};

const logCustomer = (data) => {
  const customers = JSON.parse(fs.readFileSync(customersFile));
  const dashboardKey = generateDashboardKey();
  customers.push({ ...data, dashboardKey, date: new Date().toISOString() });
  fs.writeFileSync(customersFile, JSON.stringify(customers, null, 2));
  return dashboardKey;
};

const sendWelcomeEmail = async (email, customerName, dashboardKey, isPro = false) => {
  const hostname = process.env.RENDER_EXTERNAL_HOSTNAME || 'chatvora.onrender.com';
  const embedCode = isPro
    ? `&lt;script src="https://${hostname}/widget.js" data-key="${dashboardKey}" data-email="${email}"&gt;&lt;/script&gt;`
    : `&lt;script src="https://${hostname}/widget.js"&gt;&lt;/script&gt;`;
  const dashboardSection = isPro ? `
        <hr style="border: none; border-top: 1px solid #222; margin: 24px 0;">

        <p style="color: #888; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; font-weight: 600; margin-bottom: 12px;">Your Leads Dashboard <span style="background: #00d47e; color: #000; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 700;">PRO</span></p>
        <p style="color: #ccc;">View all captured leads, download CSV, and track performance:</p>
        <div style="background: #0a0a0a; padding: 16px; border-radius: 8px; border: 1px solid #00d47e; margin: 16px 0;">
          <a href="https://${hostname}/leads.html?key=${dashboardKey}" style="color: #00d47e; font-weight: 600; text-decoration: none; font-size: 14px;">→ Open your Leads Dashboard</a>
        </div>
        <p style="color: #888; font-size: 12px;">Your dashboard key: <code style="background: #1a1a1a; padding: 2px 6px; border-radius: 4px; color: #00d47e;">${dashboardKey}</code></p>
        <p style="color: #888; font-size: 12px;">You'll also receive email alerts whenever a new lead is captured.</p>
  ` : '';
  const mailOptions = {
    from: `"ChatVora AI" <${process.env.SENDER_EMAIL}>`,
    to: email,
    subject: `Welcome to ChatVora AI, ${customerName}! 🚀`,
    html: `
      <div style="font-family: -apple-system, 'Segoe UI', sans-serif; padding: 32px; color: #ffffff; max-width: 600px; margin: 0 auto; background: #111111; border: 1px solid #222; border-radius: 12px;">
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 24px;">
          <div style="width: 8px; height: 8px; background: #00d47e; border-radius: 50%;"></div>
          <span style="font-weight: 700; font-size: 16px;">ChatVora</span>
        </div>
        <h2 style="color: #00d47e; font-size: 22px; margin-bottom: 8px;">Your AI Chatbot is Ready!</h2>
        <p style="color: #888;">Hi ${customerName},</p>
        <p style="color: #888;">Thank you for choosing ChatVora. Your AI chatbot has been set up and is ready to go live on your website.</p>

        <hr style="border: none; border-top: 1px solid #222; margin: 24px 0;">

        <p style="color: #888; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; font-weight: 600; margin-bottom: 12px;">Your embed code</p>
        <p style="color: #ccc;">Copy this one line and paste it into your website:</p>
        <div style="background: #0a0a0a; padding: 16px; border-radius: 8px; border: 1px solid #222; font-family: monospace; font-size: 13px; color: #00d47e; overflow-x: auto; margin: 16px 0;">
          ${embedCode}
        </div>
        ${dashboardSection}

        <hr style="border: none; border-top: 1px solid #222; margin: 24px 0;">

        <p style="color: #888; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; font-weight: 600; margin-bottom: 16px;">Install guide for your platform</p>

        <div style="background: #0a0a0a; padding: 16px; border-radius: 8px; border: 1px solid #222; margin-bottom: 12px;">
          <p style="color: #00d47e; font-weight: 600; margin-bottom: 8px;">WordPress</p>
          <p style="color: #aaa; font-size: 13px; line-height: 1.6; margin: 0;">
            1. Install the free "WPCode" plugin (Plugins → Add New → search "WPCode")<br>
            2. Go to Code Snippets → Add Snippet → select "Add Your Custom Code"<br>
            3. Set code type to "HTML Snippet"<br>
            4. Paste the embed code above<br>
            5. Set location to "Site Wide Footer"<br>
            6. Toggle it to Active and click Save
          </p>
        </div>

        <div style="background: #0a0a0a; padding: 16px; border-radius: 8px; border: 1px solid #222; margin-bottom: 12px;">
          <p style="color: #00d47e; font-weight: 600; margin-bottom: 8px;">Wix</p>
          <p style="color: #aaa; font-size: 13px; line-height: 1.6; margin: 0;">
            1. Go to your Wix Dashboard<br>
            2. Click Settings → Custom Code<br>
            3. Click "+ Add Code"<br>
            4. Paste the embed code above<br>
            5. Set it to load on "All pages" in the "Body - end" position<br>
            6. Click Apply
          </p>
        </div>

        <div style="background: #0a0a0a; padding: 16px; border-radius: 8px; border: 1px solid #222; margin-bottom: 12px;">
          <p style="color: #00d47e; font-weight: 600; margin-bottom: 8px;">Squarespace</p>
          <p style="color: #aaa; font-size: 13px; line-height: 1.6; margin: 0;">
            1. Go to Settings → Advanced → Code Injection<br>
            2. Paste the embed code in the "Footer" box<br>
            3. Click Save
          </p>
        </div>

        <div style="background: #0a0a0a; padding: 16px; border-radius: 8px; border: 1px solid #222; margin-bottom: 12px;">
          <p style="color: #00d47e; font-weight: 600; margin-bottom: 8px;">Shopify</p>
          <p style="color: #aaa; font-size: 13px; line-height: 1.6; margin: 0;">
            1. Go to Online Store → Themes → Edit Code<br>
            2. Open "theme.liquid"<br>
            3. Paste the embed code just before &lt;/body&gt;<br>
            4. Click Save
          </p>
        </div>

        <div style="background: #0a0a0a; padding: 16px; border-radius: 8px; border: 1px solid #222; margin-bottom: 12px;">
          <p style="color: #00d47e; font-weight: 600; margin-bottom: 8px;">Any other website</p>
          <p style="color: #aaa; font-size: 13px; line-height: 1.6; margin: 0;">
            Paste the embed code anywhere before the &lt;/body&gt; tag in your HTML. The chat widget will appear automatically in the bottom-right corner.
          </p>
        </div>

        <hr style="border: none; border-top: 1px solid #222; margin: 24px 0;">

        <p style="color: #888; font-size: 13px;">Once installed, the chat bubble appears on your site instantly. Click it and say "Hello" to test!</p>
        <p style="color: #888; font-size: 13px;">Need help installing? Reply to this email and we'll walk you through it.</p>
        <p style="color: #555; font-size: 12px; margin-top: 32px;">— The ChatVora Team</p>
      </div>
    `
  };
  return transporter.sendMail(mailOptions);
};

// ── Webhook Handler (Automated) ──────────────────────────
app.post('/api/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const email = session.customer_details.email;
    const name = session.customer_details.name || 'Valued Client';
    const amount = session.amount_total / 100;
    const isPro = amount >= 90; // Pro plan is $99/mo

    console.log(`💰 New Sale: ${email} | Plan: ${isPro ? 'Pro' : 'Starter'} ($${amount}) | Initiating Handoff...`);
    const dashboardKey = logCustomer({ email, name, amount, plan: isPro ? 'pro' : 'starter' });
    
    try {
      await sendWelcomeEmail(email, name, dashboardKey, isPro);
      console.log(`✅ Automated Handoff Delivered to ${email} | Key: ${dashboardKey}`);
    } catch (e) {
      console.error('Email failed but sale was logged:', e.message);
    }
  }
  res.json({ received: true });
});

// ── Admin Leads Endpoint ───────────────────────────────────────
app.get('/api/leads', (req, res) => {
  try {
    const customers = JSON.parse(fs.readFileSync(customersFile));
    res.json(customers);
  } catch (e) {
    res.status(500).json({ error: "Could not load leads" });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), stats });
});

// ── Stripe Billing ─────────────────────────────────────────────
app.get('/api/config', (req, res) => {
  res.json({ publishableKey: process.env.STRIPE_PUBLISHABLE_KEY });
});

app.post('/api/create-checkout-session', async (req, res) => {
  const { priceId } = req.body;
  try {
    const session = await stripe.checkout.sessions.create({
      mode: priceId.includes('sub') ? 'subscription' : 'payment',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${req.headers.origin || 'https://chatvora.onrender.com'}/success.html`,
      cancel_url: `${req.headers.origin || 'https://chatvora.onrender.com'}/`,
    });
    res.json({ url: session.url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Onboarding Data ───────────────────────────────────────────
const onboardingFile = path.join(__dirname, 'onboarding.json');
const scrapedLeadsFile = path.join(__dirname, 'scraped_leads.json');

if (!fs.existsSync(onboardingFile)) fs.writeFileSync(onboardingFile, JSON.stringify([]));
if (!fs.existsSync(scrapedLeadsFile)) fs.writeFileSync(scrapedLeadsFile, JSON.stringify([]));

// ── Client Intake Form → Stripe ──────────────────────────────
app.post('/api/onboard', async (req, res) => {
  try {
    const data = req.body;
    // Save intake form data
    const submissions = JSON.parse(fs.readFileSync(onboardingFile));
    submissions.push({ ...data, date: new Date().toISOString() });
    fs.writeFileSync(onboardingFile, JSON.stringify(submissions, null, 2));
    console.log(`📋 New intake form: ${data.businessName} (${data.industry})`);

    // Determine which Stripe price to use
    // Both plans are now monthly subscriptions
    const priceId = data.plan === 'pro'
      ? (process.env.STRIPE_PRICE_PRO || 'price_1TF9P5ItaqAtbYiGYIuZRQUV')
      : (process.env.STRIPE_PRICE_STARTER || 'price_1TF9NKItaqAtbYiGpOIXLjG2');

    const mode = 'subscription';

    const session = await stripe.checkout.sessions.create({
      mode,
      payment_method_types: ['card'],
      customer_email: data.email,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${req.headers.origin || 'https://chatvora.onrender.com'}/success.html`,
      cancel_url: `${req.headers.origin || 'https://chatvora.onrender.com'}/onboard.html`,
      metadata: {
        businessName: data.businessName,
        industry: data.industry,
        website: data.website || '',
        voice: data.voice || 'female-us'
      }
    });

    res.json({ url: session.url });
  } catch (e) {
    console.error('Onboard error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Admin: Get Onboarding Submissions ─────────────────────────
app.get('/api/admin/onboarding', (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(onboardingFile));
    res.json(data);
  } catch (e) {
    res.json([]);
  }
});

// ── Admin: Scrape Leads (In-Process) ──────────────────────────
app.get('/api/admin/scrape', (req, res) => {
  const industry = req.query.industry || 'Dentists';
  const location = req.query.location || 'London';

  console.log(`🔍 Admin scrape: ${industry} in ${location}`);

  // Generate realistic demo leads based on industry
  const templates = {
    'Dentists': [
      { name: 'Bright Smile Dental', website: 'https://brightsmile.com', email: 'info@brightsmile.com' },
      { name: 'City Dental Practice', website: 'https://citydental.co.uk', email: 'hello@citydental.co.uk' },
      { name: 'Premier Dental Care', website: 'https://premierdental.com', email: 'contact@premierdental.com' },
    ],
    'default': [
      { name: `${location} ${industry} Pro`, website: `https://${industry.toLowerCase().replace(/\s/g,'-')}-${location.toLowerCase()}.com`, email: `info@${industry.toLowerCase().replace(/\s/g,'-')}-${location.toLowerCase()}.com` },
      { name: `Elite ${industry}`, website: `https://elite${industry.toLowerCase().replace(/\s/g,'')}.com`, email: `hello@elite${industry.toLowerCase().replace(/\s/g,'')}.com` },
      { name: `${location} Best ${industry}`, website: `https://best${industry.toLowerCase().replace(/\s/g,'')}.com`, email: `contact@best${industry.toLowerCase().replace(/\s/g,'')}.com` },
    ]
  };

  const leads = (templates[industry] || templates['default']).map(l => ({ ...l, pitched: false, scrapedAt: new Date().toISOString() }));

  // Save scraped leads
  let existing = [];
  try { existing = JSON.parse(fs.readFileSync(scrapedLeadsFile)); } catch(e) {}
  const merged = [...existing, ...leads];
  fs.writeFileSync(scrapedLeadsFile, JSON.stringify(merged, null, 2));

  res.json({ count: leads.length, leads });
});

// ── Admin: Get Scraped Leads ──────────────────────────────────
app.get('/api/admin/scraped-leads', (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(scrapedLeadsFile));
    res.json(data);
  } catch (e) {
    res.json([]);
  }
});

// ── Admin: Send Outreach ──────────────────────────────────────
app.post('/api/admin/outreach', async (req, res) => {
  let leads = [];
  try { leads = JSON.parse(fs.readFileSync(scrapedLeadsFile)); } catch(e) {}

  const unpitched = leads.filter(l => !l.pitched);
  if (unpitched.length === 0) return res.json({ sent: 0, total: 0, errors: 0, message: 'No unpitched leads found. Scrape some first!' });

  const hostname = process.env.RENDER_EXTERNAL_HOSTNAME || 'chatvora.onrender.com';
  let sent = 0, errors = 0;

  for (const lead of unpitched) {
    try {
      await transporter.sendMail({
        from: `"ChatVora AI" <${process.env.SENDER_EMAIL}>`,
        to: lead.email,
        subject: `Quick question about ${lead.name}'s reception`,
        html: `
          <div style="font-family: sans-serif; line-height: 1.6; color: #333;">
            <p>Hi there,</p>
            <p>I was looking at <b>${lead.name}</b> and noticed you have a great reputation. I built a custom AI Voice Assistant specifically for local businesses like yours to handle missed calls and booking inquiries 24/7.</p>
            <p>I'd love for you to hear what it sounds like:</p>
            <p><a href="https://${hostname}/index.html" style="background: #3b82f6; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;">Listen to the AI Demo</a></p>
            <p>It takes about 30 seconds to hear it in action. If you like it, we can have it live on your site by tomorrow.</p>
            <p>Best regards,<br><b>The ChatVora Team</b></p>
          </div>
        `
      });
      lead.pitched = true;
      sent++;
    } catch (e) {
      console.error(`Outreach failed for ${lead.email}:`, e.message);
      errors++;
    }
  }

  // Update leads file with pitched status
  fs.writeFileSync(scrapedLeadsFile, JSON.stringify(leads, null, 2));
  res.json({ sent, total: unpitched.length, errors });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 ChatVora Backend on ${PORT}`);
});
