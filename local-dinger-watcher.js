const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

// === Config ===
const POLL_INTERVAL = 60000;
const draftedPlayers = require('./drafted-players.json');
const teamMap = require('./player_team_mapping.json');
const logPath = './hr-log.json';
const playerTotalsPath = './player-totals.json';
const teamTotalsPath = './team-totals.json';
const applescriptPath = './sendMessage.applescript';
const recipientNumber = 'Dingers only';
const EMPTY_POLL_THRESHOLD = 2;   // 3 × 60 s = 3 min of emptiness
let   emptyPollCount       = 0;

// === NEW: daily buffer for snapshotting ===
const snapshotDir      = './daily-snapshots';
if (!fs.existsSync(snapshotDir)) fs.mkdirSync(snapshotDir, { recursive: true });

// --- Helper: what is today’s MLB schedule date in America/New_York? ----
function getMlbDateString() {
  // Shift 6 h earlier so 00 : 00–05 : 59 EST still counts as the previous day
  const SHIFT_MS = 6 * 60 * 60 * 1000;
  const now      = new Date(Date.now() - SHIFT_MS);
  return now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); // "YYYY-MM-DD"
}

// --- Track current “MLB date” & live-buffer file ------------------------
let currentMlbDate   = getMlbDateString();
let dailyBufferPath  = path.join(snapshotDir, `${currentMlbDate}-live-buffer.json`);
let dailyBuffer      = fs.existsSync(dailyBufferPath)
  ? JSON.parse(fs.readFileSync(dailyBufferPath))
  : [];




// === Init Memory ===
let seen = new Set();
if (fs.existsSync(logPath)) {
    seen = new Set(JSON.parse(fs.readFileSync(logPath)));
}
let playerTotals = fs.existsSync(playerTotalsPath) ? JSON.parse(fs.readFileSync(playerTotalsPath)) : {};
let teamTotals = fs.existsSync(teamTotalsPath) ? JSON.parse(fs.readFileSync(teamTotalsPath)) : {};

function saveState() {
    fs.writeFileSync(logPath, JSON.stringify([...seen], null, 2));
    fs.writeFileSync(playerTotalsPath, JSON.stringify(playerTotals, null, 2));
    fs.writeFileSync(teamTotalsPath, JSON.stringify(teamTotals, null, 2));
    fs.writeFileSync(dailyBufferPath, JSON.stringify(dailyBuffer, null, 2));   // NEW
}

function sendiMessage(message, playerName, fantasyTeam, distance, play) {

    const sprayMeta = getSprayMetadata(play);
    dailyBuffer.push({
        player: playerName,
        team: fantasyTeam,
        distance,
        timestamp: new Date().toISOString(),
        ...sprayMeta
    });


    execFile('osascript', [applescriptPath, message], (error, stdout, stderr) => {
        if (error) {
            console.error('❌ AppleScript error:', stderr);
        } else {
            console.log('✅ iMessage sent:', message);
        }
    });
}

function getDistance(play) {
    if (!Array.isArray(play.playEvents)) return "N/A";
    const ev = play.playEvents.find(e => e.hitData && e.hitData.totalDistance != null);
    return ev ? ev.hitData.totalDistance : "N/A";
}

function getSprayMetadata(play) {
  if (!Array.isArray(play.playEvents)) return {};

  const ev = play.playEvents.find(e => e.hitData && e.hitData.totalDistance);
  if (!ev || !ev.hitData) return {};

  const { launchAngle, launchSpeed } = ev.hitData;
  const x = ev.coordinates?.coordX || null;
  const y = ev.coordinates?.coordY || null;

  return {
    launchAngle,
    launchSpeed,
    x,
    y
  };
}

function getTeamRankings(teamTotals) {
    const teams = Object.entries(teamTotals).sort((a, b) => b[1] - a[1]);
    let ranks = {};
    let rank = 1;
    let prevScore = null;
    let skip = 0;

    for (let i = 0; i < teams.length; i++) {
        const [team, score] = teams[i];

        if (score === prevScore) {
            skip++;
        } else {
            rank += skip;
            skip = 1;
        }

        ranks[team] = (skip > 1 ? `T-${rank}` : `${rank}`);
        prevScore = score;
    }
    return ranks;
}

async function pollGames() {
    
    // See if the anchored MLB date has flipped (≈ 06 : 00 AM EST)
    const newDate = getMlbDateString();
    if (newDate !== currentMlbDate) {
        console.log(`🗓️  Rolling to new MLB date: ${newDate}`);
        currentMlbDate  = newDate;
        dailyBufferPath = path.join(snapshotDir, `${currentMlbDate}-live-buffer.json`);
        dailyBuffer     = fs.existsSync(dailyBufferPath)
            ? JSON.parse(fs.readFileSync(dailyBufferPath))
            : [];
    }

    const scheduleUrl = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${currentMlbDate}`;
    //const scheduleUrl = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=2025-07-19`;


    try {
        const { data: scheduleData } = await axios.get(scheduleUrl);

        console.log(`📅 Using date: ${getMlbDateString()}`);
        const rawGames = scheduleData.dates?.[0]?.games || [];
        const games = scheduleData.dates?.[0]?.games?.filter(g =>
            ['Live', 'Warmup', 'In Progress', 'Pre-Game'].includes(g.status?.abstractGameState)
        ) || [];

        console.log(`🔄 Polling ${games.length} active game(s) at ${new Date().toLocaleTimeString()}`);

        // --- Auto-kill logic ---------------------------------------------------
        if (games.length === 0) {
            emptyPollCount++;
            if (emptyPollCount >= EMPTY_POLL_THRESHOLD) {
                console.log('🏁 No active games for 2 straight polls. Shutting down watcher.');
                saveState();        // flush buffers one last time
                process.exit(0);
            }
        } else {
            emptyPollCount = 0;   // reset once we see a live game again
        }

    for (const game of games) {
            const gamePk = game.gamePk;
            const liveUrl = `https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`;

            try {
                const { data: liveData } = await axios.get(liveUrl, { timeout: 3000 });
                if (!liveData?.liveData?.plays) throw new Error("Incomplete liveData");
                const allPlays = liveData.liveData.plays.allPlays || [];

                for (const play of allPlays) {
                    if (play.result?.eventType !== 'home_run') continue;

                    const hrId = play.playEndTime || `${gamePk}-${play.about?.atBatIndex}`;
                    if (seen.has(hrId)) continue;

                    const playerName = play.matchup?.batter?.fullName;
                    if (!draftedPlayers.includes(playerName)) continue;

                    const distance = getDistance(play);
                    const fantasyTeam = teamMap[playerName] || 'Unknown';

                    // Update tracking
                    seen.add(hrId);
                    playerTotals[playerName] = (playerTotals[playerName] || 0) + 1;
                    teamTotals[fantasyTeam] = (teamTotals[fantasyTeam] || 0) + 1;
                    saveState();

                    // Get team rankings
                    const rankings = getTeamRankings(teamTotals);
                    const rank = rankings[fantasyTeam] || 'N/A';

                    // Format message
                    const message = `🚨 DINGER ALERT 🚨
Player: ${playerName} (${playerTotals[playerName]})
Distance: ${distance} ft.
Team: ${fantasyTeam}
Team HR Total: ${teamTotals[fantasyTeam]}
Current Rank: ${rank}`;

                    sendiMessage(message, playerName, fantasyTeam, distance, play);

                }
            } catch (err) {
                console.warn(`⚠️ Could not fetch live data for game ${gamePk}`);
                console.warn(`   URL: https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`);
                console.warn(`   Error: ${err.response?.status} – ${err.message}`);
            }
        }
    } catch (err) {
        console.error('❌ Polling error:', err.message);
    }
}

console.log('🚀 Starting Dinger Watcher (Local)');
pollGames();
setInterval(pollGames, POLL_INTERVAL);