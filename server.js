// server.js
// Paddle Slayer Ladder — plain Node http server.
// Serves the single-page scoresheet app (public/index.html) and persists its
// entire state as one JSON blob under /api/s5scoresheet.
//
// Storage: MongoDB if MONGO_URI is set, otherwise a local JSON file
// (data will reset on redeploy unless MONGO_URI is configured).

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DATA_FILE = path.join(DATA_DIR, 'scoresheet.json');

let mongo = null;
async function connectMongo() {
  if (!MONGO_URI) {
    console.log('No MONGO_URI set — using local JSON file (data resets on redeploy).');
    console.log('Set the MONGO_URI env var to persist data across deploys.');
    return;
  }
  try {
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    await client.db('admin').command({ ping: 1 });
    mongo = client.db();
    console.log('Connected to MongoDB — data will persist.');
  } catch (e) {
    console.error('MongoDB connection failed:', e.message);
    console.error('Falling back to local JSON file (data resets on redeploy).');
    mongo = null;
  }
}

async function loadScoresheet() {
  if (mongo) {
    const doc = await mongo.collection('scoresheet').findOne({ _id: 's5' });
    return doc ? doc.data : {};
  }
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    return {};
  }
}

async function saveScoresheet(data) {
  if (mongo) {
    await mongo.collection('scoresheet').replaceOne({ _id: 's5' }, { _id: 's5', data }, { upsert: true });
    return;
  }
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json;charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 5e6) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(200, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      return res.end();
    }

    if (pathname === '/api/s5scoresheet' && req.method === 'GET') {
      const data = await loadScoresheet();
      return sendJson(res, 200, data || {});
    }

    if (pathname === '/api/s5scoresheet' && req.method === 'POST') {
      const raw = await readBody(req);
      let data;
      try {
        data = JSON.parse(raw);
      } catch (e) {
        return sendJson(res, 400, { error: 'Invalid JSON body' });
      }
      await saveScoresheet(data);
      return sendJson(res, 200, { ok: true });
    }

    if (pathname === '/api/s5scoresheet/reset' && req.method === 'POST') {
      await saveScoresheet({});
      return sendJson(res, 200, { ok: true, msg: 'Scoresheet data cleared' });
    }

    if (pathname === '/health') {
      return sendJson(res, 200, {
        status: 'ok',
        mongo: mongo ? 'connected' : (MONGO_URI ? 'failed' : 'not configured'),
        time: new Date().toISOString(),
      });
    }

    if (pathname === '/' || pathname === '/index.html') {
      const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' });
      return res.end(html);
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { error: err.message || 'Server error' });
  }
});

connectMongo().then(() => {
  server.listen(PORT, () => {
    console.log(`Paddle Slayer Ladder listening on port ${PORT}`);
  });
});
