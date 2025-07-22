// send-summary.js
const fs = require('fs');
const path = require('path');
const exec = require('child_process').exec;
const { compareTeamTrends, getHotPlayersPastNDays } = require('./trends');
const playerTeamMap = require('./player_team_mapping.json');        // NEW

const recipientNumber = "Dingers only";
//const recipientNumber = '2676141720';
const SNAPSHOT_DIR = './daily-snapshots';
const NUM_DAYS = 3;

// ---------- NEW HELPERS ----------
function getLongestHomer(hrArray = []) {
  const validHRs = hrArray.filter(hr => typeof hr.distance === 'number');
  if (validHRs.length === 0) return null;
  return validHRs.reduce((max, hr) => hr.distance > max.distance ? hr : max);
}

function getHeavyLifters(playerTotals, teamTotals) {
  return Object.entries(playerTotals)
    .filter(([p, hr]) => {
      const team = playerTeamMap[p];
      return team && teamTotals[team] && hr / teamTotals[team] >= 0.33;
    })
    .map(([p, hr]) => {
      const team = playerTeamMap[p];
      const pct  = ((hr / teamTotals[team]) * 100).toFixed(0);
      return { player: p, team, pct };
    })
    .sort((a, b) => b.pct - a.pct);
}

function getTopAvgDistancePlayers(playerTotals, count = 3) {
  return Object.entries(playerTotals)
    .map(([name, val]) => {
      if (typeof val === 'number') {
        return { player: name, distances: [], valid: false };
      }

      const distances = Array.isArray(val.distances) ? val.distances : [];
      const valid = distances.length >= 2;
      const avg = valid
        ? distances.reduce((sum, d) => sum + d, 0) / distances.length
        : 0;

      return { player: name, avg: Math.round(avg), valid };
    })
    .filter(p => p.valid)
    .sort((a, b) => b.avg - a.avg)
    .slice(0, count);
}

function sendMessage(message) {
  const script = `osascript sendMessage_summary.applescript \"${recipientNumber}\" \"${message}\"`;
  exec(script, (error) => {
    if (error) {
      console.error(`Error sending message: ${error}`);
    }
  });
}

function getRecentSnapshotFiles(dir, days) {
  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .sort();

  return files.slice(-days).map(f => path.join(dir, f));
}

function loadSnapshots() {
  if (!fs.existsSync(SNAPSHOT_DIR)) {
    console.error('❌ Snapshot directory not found.');
    process.exit(1);
  }

  const files = getRecentSnapshotFiles(SNAPSHOT_DIR, NUM_DAYS);
  if (files.length < NUM_DAYS) {
    console.error('❌ Not enough snapshot data to build summary.');
    process.exit(1);
  }

  const snapshots = files.map(f => JSON.parse(fs.readFileSync(f)));
  const dates = files.map(f => path.basename(f, '.json'));

  return { snapshots, dates };
}

function formatDateMMDDYY(dateStr) {
  const [yyyy, mm, dd] = dateStr.split('-');
  return `${mm}/${dd}/${yyyy.slice(2)}`;
}

function formatStandingsWithTies(teamTotals) {
  const entries = Object.entries(teamTotals).sort((a, b) => b[1] - a[1]);
  const lines = [];
  let currentRank = 1;
  let tieRank = 1;
  let prevTotal = null;

  for (let i = 0; i < entries.length; i++) {
    const [team, total] = entries[i];

    if (total === prevTotal) {
      currentRank = tieRank;
    } else {
      tieRank = currentRank;
    }

    const isTied = entries.filter(e => e[1] === total).length > 1;
    const rankLabel = isTied ? `T-${tieRank}` : `${currentRank}`;
    lines.push(`${rankLabel}. ${team} (${total} HRs)`);

    prevTotal = total;
    currentRank = i + 2;
  }

  return lines;
}

function formatStockMovement(rankChanges) {
  const rising = [];
  const falling = [];

  for (const [team, delta] of Object.entries(rankChanges)) {
    if (delta > 0) {
      rising.push({ team, delta });
    } else if (delta < 0) {
      falling.push({ team, delta });
    }
  }

  rising.sort((a, b) => b.delta - a.delta);
  falling.sort((a, b) => a.delta - b.delta);

  const risingText = rising.length > 0 ? rising.map(e => `[+${e.delta}] ${e.team}`).join('\n') : 'None';
  const fallingText = falling.length > 0 ? falling.map(e => `[${e.delta}] ${e.team}`).join('\n') : 'None';

  return {
    risingSection: `📈 Stock Rising 📈\n\n${risingText}`,
    fallingSection: `📉 Stock Falling 📉\n\n${fallingText}`
  };
}

function formatSummary(snapshots, dates) {
  const prevData = snapshots[NUM_DAYS - 2];
  const currData = snapshots[NUM_DAYS - 1];
  const currDate = dates[NUM_DAYS - 1];
  const formattedDate = formatDateMMDDYY(currDate);

  const teamTrend = compareTeamTrends(prevData.teamTotals, currData.teamTotals);
  const hotPlayers = getHotPlayersPastNDays(snapshots);

  const sortedTeams = formatStandingsWithTies(currData.teamTotals);
  const { risingSection, fallingSection } = formatStockMovement(teamTrend.rankChanges);

  const hotText = hotPlayers.length > 0 ? hotPlayers.map(p => `- ${p.name}: ${p.delta} HRs`).join('\n') : 'None';
  const longestDay    = getLongestHomer(currData.homeRuns || []);
  const longestSeason = getLongestHomer(snapshots.flatMap(s => s.homeRuns || []));
  const longestSeasonDate = longestSeason?.timestamp
    ? new Date(longestSeason.timestamp).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric'
      })
    : 'earlier';

  const dayLongestTxt    = longestDay
    ? `${longestDay.player} – ${longestDay.distance} ft.`
    : 'N/A';
  const seasonLongestTxt = longestSeason
  ? `${longestSeason.player} – ${longestSeason.distance} ft. (${longestSeasonDate})`
  : 'N/A';

  const heavyLifters = getHeavyLifters(currData.playerTotals, currData.teamTotals);
  const heavyText = heavyLifters.length
    ? heavyLifters.map(h => `- ${h.player} (${h.team}): ${h.pct}%`).join('\n')
    : 'None';

  const seasonPlayerTotals = {}; // player → { totalHRs, distances[] }

  for (const snap of snapshots) {
    for (const [player, val] of Object.entries(snap.playerTotals || {})) {
      if (!seasonPlayerTotals[player]) {
        seasonPlayerTotals[player] = { homeRuns: 0, distances: [] };
      }

      if (typeof val === 'number') {
        seasonPlayerTotals[player].homeRuns += val;
      } else {
        seasonPlayerTotals[player].homeRuns += val.homeRuns || 0;
        if (Array.isArray(val.distances)) {
          seasonPlayerTotals[player].distances.push(...val.distances);
        }
      }
    }
  }

  const topAvgPlayers = getTopAvgDistancePlayers(seasonPlayerTotals);

  
  const avgDistanceText = topAvgPlayers.length
    ? topAvgPlayers.map(p => `- ${p.player}: ${p.avg} ft.`).join('\n')
    : 'N/A';


  return `🗓️ Recap for ${formattedDate}

🏆 Dinger Standings 🏆\n\n${sortedTeams.join('\n')}

${risingSection}

${fallingSection}

======== #ANALytics ========

📏 Longest Gat – Today\n\n${dayLongestTxt}

📏 Longest Gat – Season\n\n${seasonLongestTxt}

📊 Top 3 Avg. HR Distances (min. 2 HRs)\n
${avgDistanceText}

👨‍🍳 Let Them Cook 🔥\n(2+ dingers in past 3 days)\n\n${hotText}

💪 Carrying Harder than 2018 Lebron\n(≥ 33% of team's total HRs)\n\n${heavyText}`;

}

function main() {
  const { snapshots, dates } = loadSnapshots();
  const summary = formatSummary(snapshots, dates);
  console.log('\n📤 Summary Message:\n');
  console.log(summary);
  sendMessage(summary);
}

main();
