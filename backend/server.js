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

// ── Groq LLM ──────────────────────────────────────────────────
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';

async function callGroq(userMessage, history = []) {
  const systemPrompt = 'You are Persona, a highly intelligent AI agency receptionist. Answer concisely in 1-2 sentences.';
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
    const { message, history = [] } = req.body;
    if (!message) return res.status(400).json({ error: 'No message' });

    stats.totalRequests++;
    
    // Only cache pure zero-history queries
    if (history.length === 0) {
      const cached = replyCache.get(message.toLowerCase().trim());
      if (cached) {
        stats.cacheHits++;
        return res.json({ ...cached, cached: true, latencyMs: Date.now() - started });
      }
    }

    if (!GROQ_API_KEY || GROQ_API_KEY.length < 10) {
      return res.status(500).json({ error: 'Missing GROQ_API_KEY environment variable on Render!' });
    }

    const aiReply = await callGroq(message, history);
    const audio64 = await generateTTS(aiReply);
    const resp = { reply: aiReply, audioBase64: audio64, latencyMs: Date.now() - started };

    replyCache.set(message.toLowerCase().trim(), { reply: aiReply, audioBase64: audio64 });
    res.json(resp);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed' });
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

const logCustomer = (data) => {
  const customers = JSON.parse(fs.readFileSync(customersFile));
  customers.push({ ...data, date: new Date().toISOString() });
  fs.writeFileSync(customersFile, JSON.stringify(customers, null, 2));
};

const sendWelcomeEmail = async (email, customerName) => {
  const hostname = process.env.RENDER_EXTERNAL_HOSTNAME || 'chatvora.onrender.com';
  const mailOptions = {
    from: `"ChatVora AI" <${process.env.SENDER_EMAIL}>`,
    to: email,
    subject: `Welcome to ChatVora AI, ${customerName}! 🚀`,
    html: `
      <div style="font-family: sans-serif; padding: 20px; color: #111; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 12px;">
        <h2 style="color: #3b82f6;">Your AI Assistant is Ready!</h2>
        <p>Hi ${customerName},</p>
        <p>Thank you for choosing ChatVora. Your personalized AI Receptionist has been provisioned and is ready for duty.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
        <h3 style="color: #111;">How to Install:</h3>
        <p>Simply copy and paste this one line of code into the <b>&lt;head&gt;</b> of your website:</p>
        <div style="background: #f8fafc; padding: 15px; border-radius: 8px; border: 1px solid #e2e8f0; font-family: monospace; font-size: 14px; overflow-x: auto;">
          &lt;script src="https://${hostname}/widget.js"&gt;&lt;/script&gt;
        </div>
        <p style="margin-top: 20px;">Once added, the AI chat bubble will appear instantly. You can test it by clicking the bubble and saying "Hello."</p>
        <p style="color: #64748b; font-size: 12px; margin-top: 30px;">Best regards,<br>The ChatVora Team</p>
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

    console.log(`💰 New Sale: ${email} | Initiating Handoff...`);
    logCustomer({ email, name, amount: session.amount_total / 100 });
    
    try {
      await sendWelcomeEmail(email, name);
      console.log(`✅ Automated Handoff Delivered to ${email}`);
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
    const priceId = data.plan === 'subscription'
      ? (process.env.STRIPE_PRICE_SUBSCRIPTION || 'price_1TEUE8IdIzCuyveZcgpGi4G3')
      : (process.env.STRIPE_PRICE_SETUP || 'price_1TEUE7IdIzCuyveZOmhxAYa5');

    const mode = data.plan === 'subscription' ? 'subscription' : 'payment';

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
