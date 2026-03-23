const express = require('express');
const cors = require('cors');
const compression = require('compression');
const { exec } = require('child_process');
const util = require('util');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');

const execPromise = util.promisify(exec);
const app = express();

// ── Middleware ──────────────────────────────────────────────────
app.use(compression());
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());

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

async function callGroq(userMessage) {
  const systemPrompt = 'You are Persona, a highly intelligent AI agency receptionist. Answer concisely in 1-2 sentences.';
  const payload = JSON.stringify({
    model: 'llama-3.3-70b-versatile',
    messages: [
      { role: 'system', content: systemPrompt },
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
async function generateTTS(text) {
  const ts = Date.now();
  const fmp3 = path.resolve(__dirname, `reply_${ts}.mp3`);
  const ftxt = path.resolve(__dirname, `reply_${ts}.txt`);
  try {
    fs.writeFileSync(ftxt, text);
    await execPromise(`python -m edge_tts -f "${ftxt}" --write-media "${fmp3}" --voice en-US-AriaNeural`);
    const buf = fs.readFileSync(fmp3);
    return buf.toString('base64');
  } finally {
    try { fs.unlinkSync(ftxt); } catch {}
    try { fs.unlinkSync(fmp3); } catch {}
  }
}

const stats = { totalRequests: 0, avgLlmMs: 0, avgTtsMs: 0, cacheHits: 0 };

app.post('/api/chat', async (req, res) => {
  const started = Date.now();
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'No message' });

    stats.totalRequests++;
    
    const cached = replyCache.get(message.toLowerCase().trim());
    if (cached) {
      stats.cacheHits++;
      return res.json({ ...cached, cached: true, latencyMs: Date.now() - started });
    }

    let aiReply;
    try {
      aiReply = await callGroq(message);
    } catch (e) {
      console.log('Groq failed, falling back to g4f...');
      aiReply = await callG4F(message);
    }

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Backend on ${PORT}`);
});
