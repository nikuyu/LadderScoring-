// logic.js
// Pure functions for the 4-court ladder game. No DB access here so it can be
// unit-tested on its own.

const COURT_BONUS = { 1: 4, 2: 3, 3: 2, 4: 1 };
const WIN_POINTS = 10;

/**
 * Given teamA/teamB scores, returns 'A' or 'B'. Throws on a tie (not allowed).
 */
function decideWinner(teamAScore, teamBScore) {
  if (teamAScore === teamBScore) {
    throw new Error('Scores cannot be tied - there must be a winner.');
  }
  return teamAScore > teamBScore ? 'A' : 'B';
}

/**
 * Points a single player earns for one match.
 * Win = 10 + court bonus. Loss = 0.
 */
function pointsForResult(court, isWinner) {
  if (!isWinner) return 0;
  return WIN_POINTS + COURT_BONUS[court];
}

/**
 * Cross-pairs two incoming teams (2 players each) into two brand new teams,
 * guaranteeing neither player keeps their previous partner (since the two
 * input teams always come from two different matches).
 * Randomly picks one of the two valid cross-pairings.
 */
function crossPair(teamP, teamQ) {
  const [p1, p2] = teamP;
  const [q1, q2] = teamQ;
  if (Math.random() < 0.5) {
    return { teamA: [p1, q1], teamB: [p2, q2] };
  }
  return { teamA: [p1, q2], teamB: [p2, q1] };
}

/**
 * Builds the next round's 4 matches from the current (completed) round.
 *
 * currentMatches: array of 4 objects, one per court:
 *   { court, teamA: [id,id], teamB: [id,id], winner: 'A' | 'B' }
 *
 * Movement rules:
 *   Winners: C4->C3, C3->C2, C2->C1, C1 stays.
 *   Losers:  C4/C3/C2 stay, C1 loser -> C4.
 *
 * Returns array of 4 new matches (court, teamA, teamB) with no scores yet.
 */
function buildNextRound(currentMatches) {
  const byCourt = {};
  for (const m of currentMatches) byCourt[m.court] = m;

  for (const c of [1, 2, 3, 4]) {
    if (!byCourt[c]) throw new Error(`Missing match data for court ${c}`);
    if (byCourt[c].winner !== 'A' && byCourt[c].winner !== 'B') {
      throw new Error(`Court ${c} has no winner recorded yet.`);
    }
  }

  const winTeam = (c) => (byCourt[c].winner === 'A' ? byCourt[c].teamA : byCourt[c].teamB);
  const loseTeam = (c) => (byCourt[c].winner === 'A' ? byCourt[c].teamB : byCourt[c].teamA);

  // Teams arriving at each court next round, before re-pairing.
  const arrivals = {
    1: [winTeam(1), winTeam(2)],   // C1 winner stays, C2 winner moves up
    2: [loseTeam(2), winTeam(3)],  // C2 loser stays, C3 winner moves up
    3: [loseTeam(3), winTeam(4)],  // C3 loser stays, C4 winner moves up
    4: [loseTeam(4), loseTeam(1)], // C4 loser stays, C1 loser drops down
  };

  const nextMatches = [];
  for (const c of [1, 2, 3, 4]) {
    const [teamP, teamQ] = arrivals[c];
    const { teamA, teamB } = crossPair(teamP, teamQ);
    nextMatches.push({ court: c, teamA, teamB, teamAScore: null, teamBScore: null, winner: null });
  }
  return nextMatches;
}

/**
 * Computes cumulative standings across all completed rounds.
 * rounds: array of round docs, each with .matches (each match may or may not
 * have a winner yet - matches without a winner are ignored).
 * players: array of {_id, name}
 * Returns array sorted by points desc: [{ playerId, name, points, wins, losses }]
 */
function computeStandings(rounds, players) {
  const table = {};
  for (const p of players) {
    table[String(p._id)] = { playerId: String(p._id), name: p.name, points: 0, wins: 0, losses: 0 };
  }

  for (const round of rounds) {
    for (const m of round.matches || []) {
      if (m.winner !== 'A' && m.winner !== 'B') continue;
      const winners = m.winner === 'A' ? m.teamA : m.teamB;
      const losers = m.winner === 'A' ? m.teamB : m.teamA;
      for (const pid of winners) {
        const row = table[String(pid)];
        if (!row) continue;
        row.points += pointsForResult(m.court, true);
        row.wins += 1;
      }
      for (const pid of losers) {
        const row = table[String(pid)];
        if (!row) continue;
        row.points += pointsForResult(m.court, false);
        row.losses += 1;
      }
    }
  }

  return Object.values(table).sort((a, b) => b.points - a.points);
}

module.exports = {
  COURT_BONUS,
  WIN_POINTS,
  decideWinner,
  pointsForResult,
  crossPair,
  buildNextRound,
  computeStandings,
};
