const express = require('express');
const cors = require('cors');
const compression = require('compression');
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

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), stats });
});

// ── Stripe Billing ─────────────────────────────────────────────
app.get('/api/config', (req, res) => {
  res.json({ publishableKey: process.env.STRIPE_PUBLISHABLE_KEY });
});

app.post('/api/create-checkout-session', async (req, res) => {
  const { priceId } = req.body; // priceId for Setup Fee or Subscription
  try {
    const session = await stripe.checkout.sessions.create({
      mode: priceId.includes('sub') ? 'subscription' : 'payment',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${req.headers.origin}/success.html`,
      cancel_url: `${req.headers.origin}/`,
    });
    res.json({ url: session.url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Backend on ${PORT}`);
});
