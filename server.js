// server.js
// Plain Node http server (no Express), MongoDB driver, cookie-based admin auth.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ObjectId } = require('mongodb');
const { getDb } = require('./db');
const { decideWinner, buildNextRound, computeStandings } = require('./logic');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';

// In-memory session store: token -> expiry timestamp. Fine for a small club
// app; sessions reset if the server restarts (admin just logs in again).
const sessions = new Map();
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

function newSessionToken() {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  return token;
}

function isValidSession(token) {
  if (!token) return false;
  const expiry = sessions.get(token);
  if (!expiry) return false;
  if (Date.now() > expiry) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
};

function serveStatic(req, res, filePath) {
  const ext = path.extname(filePath);
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

function requireAdmin(req, res) {
  const cookies = parseCookies(req);
  if (!isValidSession(cookies.adminToken)) {
    sendJson(res, 401, { error: 'Not authenticated as admin.' });
    return false;
  }
  return true;
}

async function handleApi(req, res, urlPath, query) {
  const db = await getDb();
  const players = db.collection('players');
  const rounds = db.collection('rounds');

  // ---- Auth ----
  if (urlPath === '/api/admin/login' && req.method === 'POST') {
    const body = await readBody(req);
    if (body.password !== ADMIN_PASSWORD) {
      return sendJson(res, 401, { error: 'Wrong password.' });
    }
    const token = newSessionToken();
    res.setHeader('Set-Cookie', `adminToken=${token}; HttpOnly; Path=/; Max-Age=${SESSION_TTL_MS / 1000}; SameSite=Lax`);
    return sendJson(res, 200, { ok: true });
  }

  if (urlPath === '/api/admin/logout' && req.method === 'POST') {
    const cookies = parseCookies(req);
    sessions.delete(cookies.adminToken);
    res.setHeader('Set-Cookie', 'adminToken=; HttpOnly; Path=/; Max-Age=0');
    return sendJson(res, 200, { ok: true });
  }

  if (urlPath === '/api/admin/check' && req.method === 'GET') {
    const cookies = parseCookies(req);
    return sendJson(res, 200, { loggedIn: isValidSession(cookies.adminToken) });
  }

  // ---- Players ----
  if (urlPath === '/api/players' && req.method === 'GET') {
    const list = await players.find({}).sort({ name: 1 }).toArray();
    return sendJson(res, 200, list);
  }

  if (urlPath === '/api/players' && req.method === 'POST') {
    if (!requireAdmin(req, res)) return;
    const body = await readBody(req);
    const name = (body.name || '').trim();
    if (!name) return sendJson(res, 400, { error: 'Name is required.' });
    const result = await players.insertOne({ name });
    return sendJson(res, 200, { _id: result.insertedId, name });
  }

  if (urlPath.startsWith('/api/players/') && req.method === 'DELETE') {
    if (!requireAdmin(req, res)) return;
    const id = urlPath.split('/')[3];
    await players.deleteOne({ _id: new ObjectId(id) });
    return sendJson(res, 200, { ok: true });
  }

  // ---- Rounds ----
  if (urlPath === '/api/rounds' && req.method === 'GET') {
    const list = await rounds.find({}).sort({ roundNumber: 1 }).toArray();
    return sendJson(res, 200, list);
  }

  // Round 1 manual setup (admin assigns all 4 courts)
  if (urlPath === '/api/rounds/setup' && req.method === 'POST') {
    if (!requireAdmin(req, res)) return;
    const body = await readBody(req);
    const existing = await rounds.findOne({});
    if (existing) {
      return sendJson(res, 400, { error: 'A ladder already exists. Reset it first if you want to restart.' });
    }
    const matches = validateAndNormalizeMatches(body.matches);
    if (matches.error) return sendJson(res, 400, { error: matches.error });
    await rounds.insertOne({ roundNumber: 1, matches: matches.value, createdAt: new Date() });
    return sendJson(res, 200, { ok: true });
  }

  // Submit a score for one match in the current (latest, incomplete) round
  if (urlPath === '/api/rounds/score' && req.method === 'POST') {
    if (!requireAdmin(req, res)) return;
    const body = await readBody(req);
    const court = Number(body.court);
    const teamAScore = Number(body.teamAScore);
    const teamBScore = Number(body.teamBScore);
    if (![1, 2, 3, 4].includes(court)) return sendJson(res, 400, { error: 'Invalid court.' });
    if (!Number.isFinite(teamAScore) || !Number.isFinite(teamBScore)) {
      return sendJson(res, 400, { error: 'Scores must be numbers.' });
    }

    const latest = await rounds.find({}).sort({ roundNumber: -1 }).limit(1).next();
    if (!latest) return sendJson(res, 400, { error: 'No round exists yet. Set up Round 1 first.' });

    const match = latest.matches.find((m) => m.court === court);
    if (!match) return sendJson(res, 400, { error: 'Court not found in current round.' });

    let winner;
    try {
      winner = decideWinner(teamAScore, teamBScore);
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }

    match.teamAScore = teamAScore;
    match.teamBScore = teamBScore;
    match.winner = winner;

    await rounds.updateOne({ _id: latest._id }, { $set: { matches: latest.matches } });

    // If all 4 matches now have a winner, auto-generate the next round.
    const allDone = latest.matches.every((m) => m.winner === 'A' || m.winner === 'B');
    let nextRoundCreated = false;
    if (allDone) {
      const already = await rounds.findOne({ roundNumber: latest.roundNumber + 1 });
      if (!already) {
        const nextMatches = buildNextRound(latest.matches);
        await rounds.insertOne({
          roundNumber: latest.roundNumber + 1,
          matches: nextMatches,
          createdAt: new Date(),
        });
        nextRoundCreated = true;
      }
    }

    return sendJson(res, 200, { ok: true, roundComplete: allDone, nextRoundCreated });
  }

  // Reset the whole ladder (rounds only - keeps player list)
  if (urlPath === '/api/rounds/reset' && req.method === 'POST') {
    if (!requireAdmin(req, res)) return;
    await rounds.deleteMany({});
    return sendJson(res, 200, { ok: true });
  }

  // ---- Standings ----
  if (urlPath === '/api/standings' && req.method === 'GET') {
    const allRounds = await rounds.find({}).sort({ roundNumber: 1 }).toArray();
    const allPlayers = await players.find({}).toArray();
    const standings = computeStandings(allRounds, allPlayers);
    return sendJson(res, 200, standings);
  }

  sendJson(res, 404, { error: 'Not found' });
}

function validateAndNormalizeMatches(rawMatches) {
  if (!Array.isArray(rawMatches) || rawMatches.length !== 4) {
    return { error: 'Must provide exactly 4 matches (one per court).' };
  }
  const seenCourts = new Set();
  const value = [];
  for (const m of rawMatches) {
    const court = Number(m.court);
    if (![1, 2, 3, 4].includes(court)) return { error: `Invalid court: ${m.court}` };
    if (seenCourts.has(court)) return { error: `Duplicate court ${court}` };
    seenCourts.add(court);
    if (!Array.isArray(m.teamA) || m.teamA.length !== 2 || !Array.isArray(m.teamB) || m.teamB.length !== 2) {
      return { error: `Court ${court} needs exactly 2 players per team.` };
    }
    value.push({
      court,
      teamA: m.teamA,
      teamB: m.teamB,
      teamAScore: null,
      teamBScore: null,
      winner: null,
    });
  }
  return { value };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const urlPath = url.pathname;

  try {
    if (urlPath.startsWith('/api/')) {
      await handleApi(req, res, urlPath, url.searchParams);
      return;
    }

    // Static files
    let filePath;
    if (urlPath === '/' || urlPath === '/index.html') {
      filePath = path.join(__dirname, 'public', 'index.html');
    } else if (urlPath === '/admin') {
      filePath = path.join(__dirname, 'public', 'admin.html');
    } else {
      filePath = path.join(__dirname, 'public', urlPath);
    }

    serveStatic(req, res, filePath);
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { error: err.message || 'Server error' });
  }
});

server.listen(PORT, () => {
  console.log(`Ladder app listening on port ${PORT}`);
});
