# Ladder App

4-court ladder game. Admin keys in scores, app auto-generates the next round. Public page shows live standings + round history, no login needed.

## Rules implemented
- 4 courts, 2v2 (doubles). Court 1 = highest, Court 4 = lowest.
- Winner: C4→C3, C3→C2, C2→C1, C1 stays.
- Loser: stays at C2/C3/C4. Loser at C1 drops to C4.
- Partner rotation: whenever two teams arrive together at a new court, they're
  automatically cross-paired into new teams so nobody repeats last round's partner.
- Scoring: Win = 10 + court bonus (C1 +4, C2 +3, C3 +2, C4 +1). Loss = 0.

Round 1 is the only round set up manually (admin assigns the 16 players to
courts/teams). Every round after that is generated automatically once all 4
scores for the current round are entered.

## Setup

1. Install dependencies:
   ```
   npm install
   ```
2. Copy `.env.example` to `.env` and fill in:
   - `MONGODB_URI` — your MongoDB Atlas connection string
   - `ADMIN_PASSWORD` — password for the /admin page
3. Run locally:
   ```
   node server.js
   ```
   (or `npm start`)
4. Open `http://localhost:3000` for the public standings page, and
   `http://localhost:3000/admin` to log in and run the ladder.

## Deploying (Render, same as your other app)

- Push this repo to GitHub.
- New Web Service on Render → connect the repo.
- Build command: `npm install`
- Start command: `node server.js`
- Add environment variables `MONGODB_URI` and `ADMIN_PASSWORD` in Render's dashboard.

## How a round works (admin side)

1. **First time only:** add at least 16 players (Admin → Players), then use
   "Set Up Round 1" to assign 4 players to each court (2 vs 2).
2. Each week, open `/admin`, log in, and enter the score for each of the 4
   courts. Winner is whichever score is higher (ties aren't allowed — pickleball
   games don't end in a tie).
3. Once all 4 scores for the round are in, the next round's courts/teams are
   generated automatically and shown next time you open `/admin`.
4. "Reset ladder" wipes all rounds/scores but keeps your player list, in case
   you want to start a new season.

## Notes / assumptions worth knowing
- Assumes exactly 16 active players (4 per court) each round. If your
  attendance varies week to week, let me know and I can add a way to swap
  a player in/out of Round 1 setup — right now the round-1 setup screen picks
  from whatever's in the player list, but auto-generated rounds always carry
  forward the same 16 people.
- No login for the public view — anyone with the link can see standings/history.
- Admin auth is a single shared password (session cookie, 12h), not per-admin
  accounts — fine for one club admin, let me know if you want multiple admin
  logins later.
