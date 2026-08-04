# Paddle Slayer Ladder

Tier-based pickleball ladder scoresheet. A single-page app (`public/index.html`)
handles everything — match entry, standings, player roster, admin edit-mode —
and persists its whole state as one JSON blob through a tiny Node API.

## How it works

- A single ladder with one player roster and weekly scoresheet.
- Admin assigns two players to Team A and two to Team B per match, then keys
  in each side's actual game score (e.g. 11-7). The winner is detected
  automatically from the score — no separate "who won" step. A match only
  counts toward standings once both teams and a valid, non-tied score are
  entered; the score inputs turn red if they're tied.
- Points per player are still the fixed win/loss + court-bonus formula
  (win = 10 + court bonus, loss = court bonus) — the game score is recorded
  for the record, it doesn't change the points math.
- Standings tab shows cumulative or weekly points, ranked.
- Players tab (admin only) manages the roster — add players with a name,
  optional handle/avatar (Reclub-style `@handle` + numeric avatar id), and a
  tier.
- The roster starts **empty** — add players from the Players tab once you're
  logged in as admin.
- Everything (roster, weekly scores, attendance) autosaves to the server as
  one JSON document; there's no per-match database — the client owns the
  data model and the server just stores/returns the blob.

## Admin access

Click **🔒 Admin** in the header and enter the password. It's set in
`public/index.html` as `ADMIN_PASS` (search for `var ADMIN_PASS=`) —
currently `slayer2026`. Change it there before you share the link publicly.

Note: like the original system this was adapted from, admin gating is
**client-side only** (a password check in the page's JS, not a server-side
auth token). That's fine for keeping casual visitors from editing scores, but
don't treat it as real security — anyone who reads the page source can see
the password. Ask if you want server-side auth instead.

## Setup

1. Install dependencies:
   ```
   npm install
   ```
2. Copy `.env.example` to `.env`. `MONGO_URI` is optional — without it, data
   is stored in `data/scoresheet.json` locally (resets on redeploy).
3. Run locally:
   ```
   node server.js
   ```
   (or `npm start`)
4. Open `http://localhost:3000`.

## Deploying (Render, or similar)

- Push this repo to GitHub.
- New Web Service → connect the repo.
- Build command: `npm install`
- Start command: `node server.js`
- Optionally add `MONGO_URI` in the dashboard to persist data across deploys.

## API

- `GET /api/s5scoresheet` — returns the current saved state (`{}` if nothing
  saved yet).
- `POST /api/s5scoresheet` — replaces the saved state with the request body.
- `POST /api/s5scoresheet/reset` — clears all saved data.
- `GET /health` — storage status check.

## Branding

- Logo and colors are baked into `public/index.html` (`var BP=` holds the
  logo as a base64 data URI; the header bar uses `#7f1d1d`).
- Title: "Paddle Slayer Ladder".
