const https = require('https');
require('dotenv').config({ path: './backend/.env' });

const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;

const payload = JSON.stringify({ text: "Hello, this is a test of the Deepgram Aura voice." });

const req = https.request({
  hostname: 'api.deepgram.com',
  path: '/v1/speak?model=aura-asteria-en&encoding=mp3',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Token ${DEEPGRAM_API_KEY}`,
    'Content-Length': Buffer.byteLength(payload)
  }
}, (res) => {
  console.log('Status:', res.statusCode);
  const chunks = [];
  res.on('data', c => chunks.push(c));
  res.on('end', () => {
    const buf = Buffer.concat(chunks);
    console.log('Audio received, bytes:', buf.length);
  });
});

req.on('error', console.error);
req.write(payload);
req.end();
