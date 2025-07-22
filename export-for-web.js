const fs = require('fs');
const path = require('path');

const snapshotDir = path.join(__dirname, 'daily-snapshots');
const outputPath = path.join(__dirname, 'docs', 'data', 'latest.json');

const playerTeamMap = JSON.parse(fs.readFileSync('player_team_mapping.json'));
const teamTotals = JSON.parse(fs.readFileSync('team-totals.json'));
const playerTotals = JSON.parse(fs.readFileSync('player-totals.json'));

function getPreviousDateString() {
  const now = new Date();
  now.setDate(now.getDate() - 1);
  return now.toISOString().split('T')[0];
}

function loadSnapshot(dateString) {
  const filePath = path.join(snapshotDir, `${dateString}.json`);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath));
}

function loadAllSnapshots() {
  const files = fs.readdirSync(snapshotDir);
  return files
    .filter(f => f.endsWith('.json'))
    .map(f => JSON.parse(fs.readFileSync(path.join(snapshotDir, f))));
}

function formatHeavyLifters(playerTotals, teamTotals) {
  const heavy = [];
  for (const [player, total] of Object.entries(playerTotals)) {
    const team = playerTeamMap[player];
    const teamTotal = teamTotals[team] || 0;
    const pct = teamTotal ? (total / teamTotal) : 0;
    if (pct >= 0.33) {
      heavy.push({ player, team, hrs: total, pctOfTeam: +(pct * 100).toFixed(1) });
    }
  }
  return heavy;
}

function extractSprayData(allSnapshots) {
  const spray = [];
  for (const snap of allSnapshots) {
    if (!snap.homeRuns) continue;
    for (const hr of snap.homeRuns) {
      if (hr.x != null && hr.y != null) {
        spray.push({
          player: hr.player,
          team: playerTeamMap[hr.player],
          x: hr.x,
          y: hr.y,
          distance: hr.distance,
          date: hr.timestamp?.split('T')[0] || null
        });
      }
    }
  }
  return spray;
}

function findLongestHr(spray) {
  return spray.reduce((max, hr) =>
    (hr.distance != null && hr.distance > (max.distance || 0)) ? hr : max,
    {}
  );
}

function runExport() {
  const dateString = getPreviousDateString();
  const snapshot = loadSnapshot(dateString);
  if (!snapshot) {
    console.error('❌ No snapshot found for', dateString);
    return;
  }

  const allSnapshots = loadAllSnapshots();
  const spray = extractSprayData(allSnapshots);
  const longestHr = findLongestHr(spray);
  const heavyLifters = formatHeavyLifters(snapshot.playerTotals, snapshot.teamTotals);

  const exportData = {
    updated: new Date().toISOString(),
    teams: Object.entries(snapshot.teamTotals).map(([name, total]) => ({ name, total })),
    players: Object.entries(snapshot.playerTotals).map(([name, total]) => ({ name, total, team: playerTeamMap[name] })),
    heavyLifters,
    spray,
    longestHr
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(exportData, null, 2));
  console.log('✅ Exported latest.json for web dashboard');
}

runExport();
