// ════════════════════════════════════════════════════════════════════════════
// Firebase 資料層
// ════════════════════════════════════════════════════════════════════════════
var FIREBASE_URL = 'https://badminton-scheduler-8a849-default-rtdb.asia-southeast1.firebasedatabase.app/badminton';

function fbGet(path) {
  return fetch(FIREBASE_URL + path + '.json')
    .then(function(r) { return r.ok ? r.json() : null; })
    .catch(function() { return null; });
}

function fbPut(path, data) {
  return fetch(FIREBASE_URL + path + '.json', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).catch(function() {});
}

function loadData()           { return fbGet(''); }
function savePlayers(list)    { fbPut('/players', list); }
function saveRoundNumbers(rn) { fbPut('/roundNumbers', rn); }

function saveCurrentMatch(match) {
  var c1 = (match.courts && match.courts[0]) || { team1: [], team2: [] };
  var c2 = (match.courts && match.courts[1]) || { team1: [], team2: [] };
  fbPut('/currentMatch', match);
  fbPut('/court1', c1);
  fbPut('/court2', c2);
}

// ════════════════════════════════════════════════════════════════════════════
// App
// ════════════════════════════════════════════════════════════════════════════
function App() {
  var [tweaks, setTweaks] = React.useState(function() {
    var t = window.__TWEAKS__ || {};
    return { theme: t.theme || 'minimal', accent: t.accent || '#8ff3b5', myName: t.myName || '' };
  });
  var [showTweaks, setShowTweaks] = React.useState(false);

  // ── 角色判斷：URL 含 ?player 參數即為球員模式 ────────────────────────────
  var role = React.useMemo(function() {
    var p = new URLSearchParams(window.location.search);
    return p.has('player') ? 'player' : 'admin';
  }, []);

  // ── 內部工具：將 courts 陣列轉成 match 物件，呼叫三個儲存函式 ────────────
  function saveToStorage(pList, cList, rNums) {
    var onIds = new Set();
    cList.forEach(function(c) {
      (c.teamA || []).concat(c.teamB || []).filter(Boolean).forEach(function(p) { onIds.add(p.id); });
    });
    var match = {
      courts: cList.map(function(c) {
        return {
          team1: (c.teamA || []).filter(Boolean).map(function(p) { return p.id; }),
          team2: (c.teamB || []).filter(Boolean).map(function(p) { return p.id; }),
        };
      }),
      bench: pList.filter(function(p) { return !onIds.has(p.id); }).map(function(p) { return p.id; }),
    };
    savePlayers(pList);
    saveCurrentMatch(match);
    saveRoundNumbers(rNums);
  }

  function resultToCourts(result, pMap) {
    return result.courts.map(function(c) {
      return {
        teamA: c.team1.map(function(id) { return pMap[id]; }).filter(Boolean),
        teamB: c.team2.map(function(id) { return pMap[id]; }).filter(Boolean),
      };
    });
  }

  // ── State（初始值：球員空、兩個空場地）───────────────────────────────────
  var EMPTY_COURTS = [{ teamA: [], teamB: [] }, { teamA: [], teamB: [] }];

  var [players, setPlayers] = React.useState([]);
  var [roundNumbers, setRoundNumbers] = React.useState([1, 1]);
  var [courts, setCourts] = React.useState(EMPTY_COURTS);
  var [animatingCourts, setAnimatingCourts] = React.useState([false, false]);
  var [animKeys, setAnimKeys] = React.useState([0, 0]);
  var [meId, setMeId] = React.useState(null);

  // joined: admin = true（直接進入），player = null（載入中）→ false（顯示輸入畫面）→ true
  var [joined, setJoined] = React.useState(role !== 'player' ? true : null);

  var [qrOpen, setQROpen] = React.useState(false);
  var [isPortrait, setIsPortrait] = React.useState(function() {
    return typeof window !== 'undefined' && window.matchMedia('(max-width: 820px) and (orientation: portrait)').matches;
  });

  React.useEffect(function() {
    var mq = window.matchMedia('(max-width: 820px) and (orientation: portrait)');
    var on = function() { setIsPortrait(mq.matches); };
    mq.addEventListener ? mq.addEventListener('change', on) : mq.addListener(on);
    return function() { mq.removeEventListener ? mq.removeEventListener('change', on) : mq.removeListener(on); };
  }, []);

  // ── 啟動時從 Firebase 載入資料 ───────────────────────────────────────────
  React.useEffect(function() {
    loadData().then(function(data) {
      var pArr = (data && Array.isArray(data.players))
        ? data.players.map(window.normalizePlayer)
        : [];
      var pMap = {};
      pArr.forEach(function(p) { pMap[p.id] = p; });

      setPlayers(pArr);

      if (data && data.roundNumbers) setRoundNumbers(data.roundNumbers);

      if (data && data.currentMatch && Array.isArray(data.currentMatch.courts)) {
        var loadedCourts = data.currentMatch.courts.map(function(c) {
          return {
            teamA: (c.team1 || []).map(function(id) { return pMap[id]; }).filter(Boolean),
            teamB: (c.team2 || []).map(function(id) { return pMap[id]; }).filter(Boolean),
          };
        });
        // 確保固定兩個場地
        while (loadedCourts.length < 2) loadedCourts.push({ teamA: [], teamB: [] });
        setCourts(loadedCourts.slice(0, 2));
        // 遷移：將 currentMatch 同步寫入 /court1、/court2，確保球員端能讀到
        if (role === 'admin') saveCurrentMatch(data.currentMatch);
      }
      // 無 currentMatch 時保持預設兩個空場地，不自動排程

      // 球員模式：確認 sessionStorage 姓名是否已在名單
      if (role === 'player') {
        var savedName = sessionStorage.getItem('badminton_myName');
        if (savedName) {
          var found = pArr.find(function(p) { return p.name === savedName; });
          if (found) {
            setMeId(found.id);
            setJoined(true);
            return;
          }
        }
        setJoined(false);
      }
    });
  }, []); // 只在 mount 時執行一次

  // ── 球員加入網址：目前路徑 + ?player ─────────────────────────────────────
  var playerUrl = React.useMemo(function() {
    return window.location.origin + window.location.pathname + '?player';
  }, []);

  React.useEffect(function() {
    var handler = function(e) {
      if (!e.data || !e.data.type) return;
      if (e.data.type === '__activate_edit_mode') setShowTweaks(true);
      if (e.data.type === '__deactivate_edit_mode') setShowTweaks(false);
    };
    window.addEventListener('message', handler);
    window.parent.postMessage({ type: '__edit_mode_available' }, '*');
    return function() { window.removeEventListener('message', handler); };
  }, []);

  function updateTweaks(partial) {
    var next = Object.assign({}, tweaks, partial);
    setTweaks(next);
    window.parent.postMessage({ type: '__edit_mode_set_keys', edits: partial }, '*');
  }

  var onCourtIds = React.useMemo(function() {
    var s = new Set();
    courts.forEach(function(c) {
      (c.teamA || []).concat(c.teamB || []).filter(Boolean).forEach(function(p) { s.add(p.id); });
    });
    return s;
  }, [courts]);

  // ── 管理者模式：每 3 秒讀取 /players 更新名單 ────────────────────────────
  React.useEffect(function() {
    if (role !== 'admin') return;
    var interval = setInterval(function() {
      fbGet('/players').then(function(data) {
        if (Array.isArray(data)) setPlayers(data.map(window.normalizePlayer));
      });
    }, 3000);
    return function() { clearInterval(interval); };
  }, [role]);

  // ── 球員模式：立刻讀取一次，之後每 2 秒輪詢 ─────────────────────────────
  React.useEffect(function() {
    if (role !== 'player' || !joined) return;

    function poll() {
      return Promise.all([
        fbGet('/players'),
        fbGet('/court1'),
        fbGet('/court2'),
        fbGet('/roundNumbers'),
      ]).then(function(res) {
        var pArr = Array.isArray(res[0]) ? res[0].map(window.normalizePlayer) : [];
        var pMap = {};
        pArr.forEach(function(p) { pMap[p.id] = p; });
        setPlayers(pArr);

        function toCourtObj(c) {
          if (!c) return { teamA: [], teamB: [] };
          return {
            teamA: (c.team1 || []).map(function(id) { return pMap[id]; }).filter(Boolean),
            teamB: (c.team2 || []).map(function(id) { return pMap[id]; }).filter(Boolean),
          };
        }
        setCourts([toCourtObj(res[1]), toCourtObj(res[2])]);
        if (Array.isArray(res[3])) setRoundNumbers(res[3]);
      });
    }

    poll();
    var interval = setInterval(poll, 2000);
    return function() { clearInterval(interval); };
  }, [role, joined]);

  // ── 「下一場」：各球場獨立排程 ──────────────────────────────────────────
  function handleNextCourt(courtIdx) {
    if (role !== 'admin') return;
    if (animatingCourts[courtIdx]) return;

    setAnimatingCourts(function(prev) {
      var next = prev.slice(); next[courtIdx] = true; return next;
    });

    setTimeout(function() {
      var thisCourt = courts[courtIdx] || { teamA: [], teamB: [] };

      var thisCourtIds = new Set();
      (thisCourt.teamA || []).concat(thisCourt.teamB || []).filter(Boolean).forEach(function(p) {
        thisCourtIds.add(p.id);
      });

      var otherCourtIds = new Set();
      for (var i = 0; i < courts.length; i++) {
        if (i === courtIdx) continue;
        (courts[i].teamA || []).concat(courts[i].teamB || []).filter(Boolean).forEach(function(p) {
          otherCourtIds.add(p.id);
        });
      }

      var updatedPlayers = players.map(function(p) {
        if (otherCourtIds.has(p.id)) return p;
        if (!thisCourtIds.has(p.id)) return Object.assign({}, p, { consecutiveGames: 0 });

        var inA = (thisCourt.teamA || []).some(function(m) { return m && m.id === p.id; });
        var myTeam = inA ? thisCourt.teamA : thisCourt.teamB;
        var oppTeam = inA ? thisCourt.teamB : thisCourt.teamA;
        var teammates = (myTeam || []).filter(function(m) { return m && m.id !== p.id; });
        var opps = (oppTeam || []).filter(Boolean);

        var newPartners = Object.assign({}, p.partners);
        teammates.forEach(function(t) { newPartners[t.id] = (newPartners[t.id] || 0) + 1; });
        var newOpponents = Object.assign({}, p.opponents);
        opps.forEach(function(o) { newOpponents[o.id] = (newOpponents[o.id] || 0) + 1; });

        return Object.assign({}, p, {
          games: (p.games || 0) + 1,
          consecutiveGames: (p.consecutiveGames || 0) + 1,
          partners: newPartners,
          opponents: newOpponents,
        });
      });

      var availablePool = updatedPlayers.filter(function(p) {
        return !otherCourtIds.has(p.id);
      });

      var pMap = {};
      updatedPlayers.forEach(function(p) { pMap[p.id] = p; });

      var result = window.scheduleNextRound(availablePool, { numCourts: 1 });

      var newCourtData;
      if (result.courts.length > 0) {
        var c = result.courts[0];
        newCourtData = {
          teamA: c.team1.map(function(id) { return pMap[id]; }).filter(Boolean),
          teamB: c.team2.map(function(id) { return pMap[id]; }).filter(Boolean),
        };
      } else {
        newCourtData = { teamA: [], teamB: [] };
      }

      var newCourts = courts.map(function(c, i) {
        return i === courtIdx ? newCourtData : c;
      });

      var newRoundNumbers = roundNumbers.map(function(r, i) {
        return i === courtIdx ? r + 1 : r;
      });

      saveToStorage(updatedPlayers, newCourts, newRoundNumbers);
      setPlayers(updatedPlayers);
      setCourts(newCourts);
      setRoundNumbers(newRoundNumbers);
      setAnimKeys(function(keys) {
        var next = keys.slice(); next[courtIdx] = next[courtIdx] + 1; return next;
      });
      setTimeout(function() {
        setAnimatingCourts(function(prev) {
          var next = prev.slice(); next[courtIdx] = false; return next;
        });
      }, 520);
    }, 260);
  }

  // ── 重設：保留★球員、場地清空（兩個空場地）─────────────────────────────
  function handleReset() {
    if (role !== 'admin') return;
    if (!confirm('確定要重設？所有資料將清除。')) return;

    var kept = players.filter(function(p) { return p.regular; }).map(function(p) {
      return Object.assign({}, p, { games: 0, consecutiveGames: 0, partners: {}, opponents: {} });
    });

    var newCourts = [{ teamA: [], teamB: [] }, { teamA: [], teamB: [] }];
    var newRoundNumbers = [1, 1];
    saveToStorage(kept, newCourts, newRoundNumbers);
    setPlayers(kept);
    setCourts(newCourts);
    setRoundNumbers(newRoundNumbers);
    setAnimKeys([0, 0]);
  }

  // ── 球員管理 ──────────────────────────────────────────────────────────────
  function handleAddPlayer(name, level, pinned) {
    var newP = window.normalizePlayer({ id: 'p-' + Date.now(), name: name, level: level, games: 0, pinned: !!pinned, regular: pinned === true });
    var next = players.concat([newP]);
    setPlayers(next);
    saveToStorage(next, courts, roundNumbers);
  }

  function handleEditLevel(pid, level) {
    var next = players.map(function(p) { return p.id === pid ? Object.assign({}, p, { level: level }) : p; });
    setPlayers(next);
    savePlayers(next);
  }

  function handleTogglePin(pid) {
    var next = players.map(function(p) { return p.id === pid ? Object.assign({}, p, { regular: !p.regular }) : p; });
    setPlayers(next);
    savePlayers(next);
  }

  function handleDeletePlayer(pid) {
    if (onCourtIds.has(pid)) {
      alert('無法刪除上場中的球員，請先等對局結束。');
      return;
    }
    var next = players.filter(function(p) { return p.id !== pid; });
    setPlayers(next);
    savePlayers(next);
  }

  // ── 加入活動（球員模式）──────────────────────────────────────────────────
  function handleJoin(name) {
    sessionStorage.setItem('badminton_myName', name);
    // 先從 Firebase 取得最新球員清單，避免覆蓋其他人的資料
    fbGet('/players').then(function(current) {
      var pArr = Array.isArray(current) ? current.map(window.normalizePlayer) : [];
      var existing = pArr.find(function(p) { return p.name === name; });
      if (existing) {
        setPlayers(pArr);
        setMeId(existing.id);
        setJoined(true);
        return;
      }
      var myId = 'p-' + Date.now();
      var newMe = window.normalizePlayer({ id: myId, name: name, level: 6, games: 0, regular: false });
      var next = pArr.concat([newMe]);
      setPlayers(next);
      setMeId(myId);
      fbPut('/players', next).then(function() { setJoined(true); });
    }).catch(function() {
      setJoined(true);
    });
  }

  function handleSkip() { setJoined(true); }

  // ── Drag & Drop ───────────────────────────────────────────────────────────
  React.useEffect(function() {
    window.__onDrop = function(src, dstType, dstCourtIdx, dstTeam, dstPos) {
      if (role !== 'admin') return;

      var pMap = {};
      players.forEach(function(p) { pMap[p.id] = p; });
      var srcPlayer = pMap[src.id];
      if (!srcPlayer) return;

      var next = courts.map(function(c) {
        var a = [c.teamA ? c.teamA[0] : undefined, c.teamA ? c.teamA[1] : undefined];
        var b = [c.teamB ? c.teamB[0] : undefined, c.teamB ? c.teamB[1] : undefined];
        return { teamA: a, teamB: b };
      });

      if (dstType === 'bench') {
        if (src.from === 'court' && next[src.courtIdx]) {
          var srcTk = src.team === 'A' ? 'teamA' : 'teamB';
          next[src.courtIdx][srcTk][src.pos] = undefined;
        }
      } else {
        if (!next[dstCourtIdx]) return;
        var dstTk = dstTeam === 'A' ? 'teamA' : 'teamB';
        var targetPlayer = next[dstCourtIdx][dstTk][dstPos];

        if (src.from === 'court' &&
            src.courtIdx === dstCourtIdx &&
            src.team === dstTeam &&
            src.pos === dstPos) return;

        next[dstCourtIdx][dstTk][dstPos] = srcPlayer;

        if (src.from === 'court' && next[src.courtIdx]) {
          var srcTk2 = src.team === 'A' ? 'teamA' : 'teamB';
          next[src.courtIdx][srcTk2][src.pos] = targetPlayer;
        }
      }

      setCourts(next);
      saveToStorage(players, next, roundNumbers);
    };
    return function() { window.__onDrop = null; };
  }, [players, role, courts, roundNumbers]);

  // ── Render ────────────────────────────────────────────────────────────────

  if (joined === null) {
    return (
      <div style={{
        height: '100vh', width: '100vw',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#0c1016', color: 'var(--muted)',
        fontFamily: "'JetBrains Mono', monospace", fontSize: 12, letterSpacing: 1.5,
      }}>
        LOADING…
      </div>
    );
  }

  if (!joined) {
    return (
      <React.Fragment>
        <JoinScreen onJoin={handleJoin} onSkip={handleSkip} theme={tweaks.theme} accent={tweaks.accent} role={role} />
        <TweaksPanel state={tweaks} onChange={updateTweaks} show={showTweaks} />
      </React.Fragment>
    );
  }

  return (
    <div style={{
      minHeight: '100vh',
      height: isPortrait ? 'auto' : '100vh',
      width: '100vw',
      display: 'flex', flexDirection: 'column',
      background: tweaks.theme === 'minimal'
        ? '#0c1016'
        : 'radial-gradient(ellipse at 20% 0%, #1a2533 0%, #131820 60%, #0c1016 100%)',
    }}>
      <TopBar
        theme={tweaks.theme}
        accent={tweaks.accent}
        onReset={handleReset}
        onShowQR={function() { setQROpen(true); }}
        role={role}
        eventInfo={{ day: 'TUE', time: '20:00-22:00', location: '南科新力羽球館' }}
      />

      <div style={{
        flex: 1, display: 'flex',
        flexDirection: isPortrait ? 'column' : 'row',
        minHeight: 0, minWidth: 0,
      }}>
        <main style={{
          width: isPortrait ? '100%' : '70%',
          height: isPortrait ? 'auto' : '100%',
          flex: isPortrait ? '1 1 auto' : 'none',
          minWidth: 0, minHeight: 0,
          padding: isPortrait ? '12px 12px 8px' : '16px 18px',
          display: 'flex',
          flexDirection: isPortrait ? 'column' : 'row',
          gap: isPortrait ? 10 : 16,
        }}>
          {courts.map(function(c, i) {
            return (
              <div
                key={animKeys[i] + '-' + i}
                style={{
                  flex: isPortrait ? 'none' : 1,
                  display: 'flex',
                  minHeight: 0, minWidth: 0,
                  width: isPortrait ? '100%' : 'auto',
                  aspectRatio: isPortrait ? '5 / 4' : 'auto',
                  animation: animatingCourts[i]
                    ? 'fadeOut 260ms ease forwards'
                    : 'fadeIn 520ms cubic-bezier(.2,.8,.2,1) both',
                }}
              >
                <Court
                  index={i}
                  teamA={c.teamA}
                  teamB={c.teamB}
                  meId={meId}
                  theme={tweaks.theme}
                  accent={tweaks.accent}
                  round={roundNumbers[i]}
                  onNext={function() { handleNextCourt(i); }}
                  animating={animatingCourts[i]}
                  role={role}
                />
              </div>
            );
          })}
        </main>

        <Sidebar
          players={players}
          onCourtIds={onCourtIds}
          meId={meId}
          theme={tweaks.theme}
          accent={tweaks.accent}
          role={role}
          onEditLevel={handleEditLevel}
          onAddPlayer={handleAddPlayer}
          onDeletePlayer={handleDeletePlayer}
          onTogglePin={handleTogglePin}
          isPortrait={isPortrait}
        />
      </div>

      <TweaksPanel state={tweaks} onChange={updateTweaks} show={showTweaks} />

      {qrOpen && <QRDialog url={playerUrl} onClose={function() { setQROpen(false); }} accent={tweaks.accent} />}

      <style>{`
        @keyframes fadeIn {
          0% { opacity: 0; transform: translateY(8px) scale(0.98); }
          100% { opacity: 1; transform: none; }
        }
        @keyframes fadeOut {
          0% { opacity: 1; }
          100% { opacity: 0.15; transform: scale(0.97); }
        }
        .player-slot:hover { transform: translateY(-2px) scale(1.02); }
        ::-webkit-scrollbar { width: 8px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #2a3340; border-radius: 4px; }
        ::-webkit-scrollbar-thumb:hover { background: #3a4555; }
      `}</style>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
