const express = require('express');
const cors = require('cors');
const compression = require('compression');
const db = require('./database');
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

// Response-time header
app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ns = Number(process.hrtime.bigint() - start);
    const ms = (ns / 1e6).toFixed(2);
    res.setHeader('X-Response-Time', `${ms}ms`);
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

// ── Groq LLM (native Node.js, no Python) ──────────────────────
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';

async function callGroq(userMessage) {
  const systemPrompt =
    'You are Persona, a highly intelligent and professional AI agency receptionist. ' +
    'Answer the user instantly and concisely in exactly 1 or 2 sentences ONLY.';

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
    const req = https.request(
      {
        hostname: 'api.groq.com',
        path: '/openai/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${GROQ_API_KEY}`,
          'Content-Length': Buffer.byteLength(payload)
        }
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.choices && json.choices[0]) {
              resolve(json.choices[0].message.content.trim());
            } else {
              reject(new Error(json.error?.message || 'Groq returned no choices'));
            }
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ── Fallback: GPT4Free via Python ──────────────────────────────
async function callG4F(userMessage) {
  const safeMsg = userMessage.replace(/"/g, "'").replace(/\n/g, ' ');
  const { stdout } = await execPromise(`python llm.py "${safeMsg}"`, {
    cwd: __dirname,
    timeout: 15000
  });
  let reply = stdout.trim().replace(/g4f is up-to-date.*?[\r\n]+/g, '').trim();
  reply = reply.replace(/g4f is up-to-date \([^)]+\)\.\.\.\./g, '').trim();
  return reply || null;
}

// ── Edge-TTS (in-memory via piped stdout) ──────────────────────
async function generateTTS(text) {
  const timestamp = Date.now();
  const tempTextFile = path.resolve(__dirname, `reply_${timestamp}.txt`);
  const tempMp3File = path.resolve(__dirname, `reply_${timestamp}.mp3`);

  try {
    fs.writeFileSync(tempTextFile, text);
    await execPromise(
      `python -m edge_tts -f "${tempTextFile}" --write-media "${tempMp3File}" --voice en-US-AriaNeural`,
      { timeout: 10000 }
    );
    const mp3Buffer = fs.readFileSync(tempMp3File);
    return mp3Buffer.toString('base64');
  } finally {
    try { fs.unlinkSync(tempTextFile); } catch {}
    try { fs.unlinkSync(tempMp3File); } catch {}
  }
}

// ── Latency stats ──────────────────────────────────────────────
const stats = { totalRequests: 0, avgLlmMs: 0, avgTtsMs: 0, cacheHits: 0 };

// ── Routes ─────────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  const reqStart = Date.now();

  try {
    const { message, agentName } = req.body;
    if (!message) return res.status(400).json({ error: 'No message provided' });

    stats.totalRequests++;

    // Check cache first
    const cacheKey = message.toLowerCase().trim();
    const cached = replyCache.get(cacheKey);
    if (cached) {
      stats.cacheHits++;
      console.log(`[CACHE HIT] "${message}" → ${Date.now() - reqStart}ms`);
      return res.json({ ...cached, cached: true, latencyMs: Date.now() - reqStart });
    }

    // LLM call (Groq first, g4f fallback)
    const llmStart = Date.now();
    let aiReply;

    if (GROQ_API_KEY) {
      try {
        aiReply = await callGroq(message);
      } catch (groqErr) {
        console.warn('[GROQ FAILED]', groqErr.message, '→ falling back to g4f');
      }
    }

    if (!aiReply) {
      try {
        aiReply = await callG4F(message);
      } catch (g4fErr) {
        console.warn('[G4F FAILED]', g4fErr.message);
      }
    }

    if (!aiReply) {
      aiReply = 'I am currently undergoing an intelligence upgrade, please bear with me.';
    }

    const llmMs = Date.now() - llmStart;
    stats.avgLlmMs = Math.round((stats.avgLlmMs * (stats.totalRequests - 1) + llmMs) / stats.totalRequests);
    console.log(`[LLM] "${message}" → ${llmMs}ms`);

    // TTS
    const ttsStart = Date.now();
    let audioBase64 = null;
    try {
      audioBase64 = await generateTTS(aiReply);
    } catch (ttsErr) {
      console.warn('[TTS FAILED]', ttsErr.message, '→ browser fallback');
    }
    const ttsMs = Date.now() - ttsStart;
    stats.avgTtsMs = Math.round((stats.avgTtsMs * (stats.totalRequests - 1) + ttsMs) / stats.totalRequests);

    const totalMs = Date.now() - reqStart;
    console.log(`[TOTAL] ${totalMs}ms (LLM: ${llmMs}ms, TTS: ${ttsMs}ms)`);

    const response = { reply: aiReply, audioBase64, latencyMs: totalMs };
    replyCache.set(cacheKey, { reply: aiReply, audioBase64 });

    res.json(response);
  } catch (error) {
    console.error('[ERROR]', error);
    res.status(500).json({ error: 'Failed to process chat', latencyMs: Date.now() - reqStart });
  }
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    stats: {
      totalRequests: stats.totalRequests,
      cacheHits: stats.cacheHits,
      avgLlmMs: stats.avgLlmMs,
      avgTtsMs: stats.avgTtsMs,
      cacheHitRate: stats.totalRequests ? `${((stats.cacheHits / stats.totalRequests) * 100).toFixed(1)}%` : '0%'
    }
  });
});

// ── Start ──────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 PersonaPlex Backend running on http://localhost:${PORT}`);
  console.log(`   Groq API: ${GROQ_API_KEY ? '✅ Active' : '⚠️  Not set (using g4f fallback)'}`);
  console.log(`   Cache: 200 entries max`);
  console.log(`   Compression: gzip enabled`);
});
