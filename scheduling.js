// 球員資料正規化（補齊新欄位）
window.normalizePlayer = function(p) {
  return Object.assign({ games: 0, consecutiveGames: 0, partners: {}, opponents: {}, pinned: true, regular: true }, p);
};

// 排程演算法（score-based exhaustive search）
// score = 實力差² × 100 + 出場數標準差 × 10 + 重複隊友次數 × 3
// options: { numCourts: 1|2 }  預設 2
window.scheduleNextRound = function(players, options) {
  var PER_COURT = 4;
  var NUM_COURTS = (options && options.numCourts) ? options.numCourts : 2;
  var NEED = NUM_COURTS * PER_COURT;

  // 排除 consecutiveGames >= 2 的球員，其餘全數進入選人池
  var eligible = players.filter(function(p) { return (p.consecutiveGames || 0) < 2; });
  if (eligible.length < PER_COURT) eligible = players.slice();

  var playCount = Math.floor(Math.min(eligible.length, NEED) / PER_COURT) * PER_COURT;
  if (playCount === 0) return { courts: [], bench: players.map(function(p) { return p.id; }) };
  var numCourts = playCount / PER_COURT;

  function calcScore(courtAssigns) {
    var s = 0;
    var all = [];
    courtAssigns.forEach(function(ca) { all = all.concat(ca[0]).concat(ca[1]); });

    courtAssigns.forEach(function(ca) {
      var t1 = ca[0], t2 = ca[1];
      var s1 = t1.reduce(function(a, p) { return a + (p.level || 6); }, 0);
      var s2 = t2.reduce(function(a, p) { return a + (p.level || 6); }, 0);
      s += (s1 - s2) * (s1 - s2) * 100;
    });

    var g = all.map(function(p) { return p.games || 0; });
    var mean = g.reduce(function(a, b) { return a + b; }, 0) / g.length;
    var variance = g.reduce(function(a, v) { return a + (v - mean) * (v - mean); }, 0) / g.length;
    s += Math.sqrt(variance) * 10;

    courtAssigns.forEach(function(ca) {
      [ca[0], ca[1]].forEach(function(t) {
        if (t.length >= 2) s += ((t[0].partners || {})[t[1].id] || 0) * 3;
      });
    });
    return s;
  }

  var bestScore = Infinity, bestCourts = null;

  function trySelected(sel) {
    if (numCourts === 1) {
      for (var j = 1; j < 4; j++) {
        var t1 = [sel[0], sel[j]];
        var t2 = sel.filter(function(_, k) { return k !== 0 && k !== j; });
        var s = calcScore([[t1, t2]]);
        if (s < bestScore) { bestScore = s; bestCourts = [[t1, t2]]; }
      }
    } else {
      for (var b = 1; b < 6; b++) for (var c = b+1; c < 7; c++) for (var d = c+1; d < 8; d++) {
        var c1 = [sel[0], sel[b], sel[c], sel[d]];
        var c2 = sel.filter(function(p) { return c1.indexOf(p) === -1; });
        for (var j2 = 1; j2 < 4; j2++) {
          var t1a = [c1[0], c1[j2]];
          var t1b = c1.filter(function(_, k) { return k !== 0 && k !== j2; });
          for (var q = 1; q < 4; q++) {
            var t2a = [c2[0], c2[q]];
            var t2b = c2.filter(function(_, k) { return k !== 0 && k !== q; });
            var sc = calcScore([[t1a, t1b], [t2a, t2b]]);
            if (sc < bestScore) { bestScore = sc; bestCourts = [[t1a, t1b], [t2a, t2b]]; }
          }
        }
      }
    }
  }

  // 依 games 由少到多排序，取 minGames
  var sortedEligible = eligible.slice().sort(function(a, b) { return (a.games || 0) - (b.games || 0); });
  var minG = sortedEligible.length > 0 ? (sortedEligible[0].games || 0) : 0;

  // 嚴格限制：只從 minG 和 minG+1 的球員中選人，確保差距不超過 1
  var pool = sortedEligible.filter(function(p) { return (p.games || 0) <= minG + 1; });

  // 根據 pool 大小決定實際可排場數（不超過原本 numCourts）
  var maxCourts = Math.min(numCourts, Math.floor(pool.length / PER_COURT));
  if (maxCourts === 0) return { courts: [], bench: players.map(function(p) { return p.id; }) };
  numCourts = maxCourts;
  playCount = numCourts * PER_COURT;

  function combos(arr, k, start, current, results) {
    if (!results) results = [];
    if (!current) current = [];
    if (!start) start = 0;
    if (current.length === k) { results.push(current.slice()); return results; }
    for (var i = start; i <= arr.length - (k - current.length); i++) {
      current.push(arr[i]);
      combos(arr, k, i + 1, current, results);
      current.pop();
    }
    return results;
  }

  // pool 內枚舉最佳 playCount 人組合
  if (pool.length === playCount) {
    trySelected(pool);
  } else {
    var allCombos = combos(pool, playCount);
    for (var ci = 0; ci < allCombos.length; ci++) trySelected(allCombos[ci]);
  }

  if (!bestCourts) return { courts: [], bench: players.map(function(p) { return p.id; }) };

  var onIds = new Set();
  bestCourts.forEach(function(ca) {
    ca[0].concat(ca[1]).forEach(function(p) { onIds.add(p.id); });
  });

  return {
    courts: bestCourts.map(function(ca) {
      return {
        team1: ca[0].map(function(p) { return p.id; }),
        team2: ca[1].map(function(p) { return p.id; }),
      };
    }),
    bench: players.filter(function(p) { return !onIds.has(p.id); }).map(function(p) { return p.id; }),
  };
};

// 向下相容
window.pickNextLineup = function(players) {
  var result = window.scheduleNextRound(players);
  var pMap = {};
  players.forEach(function(p) { pMap[p.id] = p; });
  return {
    courts: result.courts.map(function(c) {
      return {
        teamA: c.team1.map(function(id) { return pMap[id]; }).filter(Boolean),
        teamB: c.team2.map(function(id) { return pMap[id]; }).filter(Boolean),
      };
    }),
  };
};

window.rotateOneCourt = function(allPlayers, currentCourts) {
  return { newCourts: currentCourts, updatedPlayers: allPlayers };
};
