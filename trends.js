// trends.js

function compareTeamTrends(prevTotals, currTotals) {
  const prevRank = Object.entries(prevTotals)
    .sort((a, b) => b[1] - a[1])
    .map(([team], i) => ({ team, rank: i }));

  const currRank = Object.entries(currTotals)
    .sort((a, b) => b[1] - a[1])
    .map(([team], i) => ({ team, rank: i }));

  const rankChanges = {};
  for (const { team, rank } of currRank) {
    const old = prevRank.find(t => t.team === team);
    if (old) {
      rankChanges[team] = old.rank - rank;
    } else {
      rankChanges[team] = 0;
    }
  }

  return { rankChanges };
}

function getHotPlayersPastNDays(snapshots) {
  const start = snapshots[0].playerTotals;
  const end = snapshots[snapshots.length - 1].playerTotals;
  const hotPlayers = [];

  for (const player in end) {
    const before = start[player] || 0;
    const after = end[player];
    const delta = after - before;

    if (delta >= 2) {
      hotPlayers.push({ name: player, delta });
    }
  }

  return hotPlayers;
}

module.exports = {
  compareTeamTrends,
  getHotPlayersPastNDays
};
