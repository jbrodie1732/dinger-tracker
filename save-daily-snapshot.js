
// save-daily-snapshot.js
//
// Manually run this script once a day (e.g. right after the last game ends)
//    node save-daily-snapshot.js
//
// It rolls today’s live buffer into a date-stamped snapshot and resets the buffer.

const fs   = require('fs');
const path = require('path');

const SNAPSHOT_DIR      = './daily-snapshots';
const PLAYER_TOTALS_SRC = './player-totals.json';
const TEAM_TOTALS_SRC   = './team-totals.json';

// --------------------------- helpers ---------------------------
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadJson(p) {
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p)) : {};
}

// --------------------------- main ------------------------------
(function main() {
  ensureDir(SNAPSHOT_DIR);

  // Get MLB date (anchored to EST and shifted back 6 hrs)
  function getMlbDateString() {
    const SHIFT_MS = 6 * 60 * 60 * 1000;
    const now = new Date(Date.now() - SHIFT_MS);
    return now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); // "YYYY-MM-DD"
  }

const today = getMlbDateString();
const BUFFER_PATH       = path.join(SNAPSHOT_DIR, `${today}-live-buffer.json`);


  const snapshotPath = path.join(SNAPSHOT_DIR, `${today}.json`);
  if (fs.existsSync(snapshotPath)) {
    console.error(`❌  Snapshot for ${today} already exists (${snapshotPath}).`);
    process.exit(1);
  }

  const snapshot = {
    date:        today,
    playerTotals: loadJson(PLAYER_TOTALS_SRC),
    teamTotals:   loadJson(TEAM_TOTALS_SRC),
    homeRuns:     loadJson(BUFFER_PATH)               // [{player,team,distance,timestamp},...]
  };

  fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));
  fs.writeFileSync(BUFFER_PATH, JSON.stringify([],       null, 2));   // reset

  console.log(`✅  Daily snapshot saved → ${snapshotPath}`);
})();
