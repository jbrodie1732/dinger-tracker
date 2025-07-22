// export-for-web.js
// Run manually after save-daily-snapshot.js to generate public/data/latest.json

const fs = require("fs");
const path = require("path");

const snapshotDir = path.join(__dirname, "daily-snapshots");
const playerTotals = require("./player-totals.json");
const teamTotals = require("./team-totals.json");
const playerTeamMap = require("./player_team_mapping.json");

const today = new Date();
today.setDate(today.getDate() - 1); // use snapshot from yesterday
const snapshotFile = path.join(
  snapshotDir,
  `${today.toISOString().slice(0, 10)}.json`
);
const outputFile = path.join(__dirname, "public", "data", "latest.json");

if (!fs.existsSync(snapshotFile)) {
  console.error("Snapshot not found:", snapshotFile);
  process.exit(1);
}

const snapshot = JSON.parse(fs.readFileSync(snapshotFile, "utf-8"));
const updated = new Date().toISOString();

const teams = Object.entries(snapshot.teamTotals || {}).map(([team, total]) => ({
  name: team,
  total
}));

const players = Object.entries(snapshot.playerTotals || {}).map(
  ([player, hrs]) => ({
    player,
    hrs,
    team: playerTeamMap[player] || "Unassigned"
  })
);

const heavyLifters = players
  .filter((p) => {
    const teamTotal = snapshot.teamTotals?.[p.team] || 0;
    return teamTotal > 0 && p.hrs / teamTotal >= 0.33;
  })
  .map((p) => ({
    ...p,
    pctOfTeam: Math.round((p.hrs / snapshot.teamTotals[p.team]) * 100)
  }));

const spray = (snapshot.homeRuns || []).filter(
  (hr) => hr.x !== undefined && hr.y !== undefined
);

const longestHr = spray.reduce((max, hr) =>
  hr.distance && hr.distance > (max?.distance || 0) ? hr : max,
  null
);

const result = {
  updated,
  teams: teams.sort((a, b) => b.total - a.total),
  players: players.sort((a, b) => b.hrs - a.hrs),
  heavyLifters,
  spray,
  longestHr: longestHr
    ? {
        player: longestHr.player,
        distance: longestHr.distance,
        team: longestHr.team,
        date: longestHr.timestamp?.slice(0, 10)
      }
    : null
};

fs.mkdirSync(path.dirname(outputFile), { recursive: true });
fs.writeFileSync(outputFile, JSON.stringify(result, null, 2));
console.log("✅ Exported latest.json for web dashboard");
