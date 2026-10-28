// 백엔드 호출 계층: API_URL이 있으면 Apps Script, 없으면 브라우저 저장소(데모)
// 서버 응답 형식: { ok:true, data } 또는 { ok:false, error:'메시지', code:'CODE' }
(function () {
  const LS = 'stair_demo_db';
  const fresh = () => ({ users: {}, records: [], open: {} });
  const load = () => { try { return JSON.parse(localStorage.getItem(LS)) || fresh(); } catch (_) { return fresh(); } };
  const save = (db) => localStorage.setItem(LS, JSON.stringify(db));
  const ss = (k) => { try { return sessionStorage.getItem(k) || ''; } catch (_) { return ''; } };
  const fail = (code, msg) => Object.assign(new Error(msg || code), { code });

  // ---------- 한국 시간(KST) 헬퍼 (데모 모드가 UTC 날짜로 계산하던 문제 방지) ----------
  const kst = (ms) => {
    const d = new Date(ms + 9 * 3600 * 1000);
    return { date: d.toISOString().slice(0, 10), min: d.getUTCHours() * 60 + d.getUTCMinutes() };
  };
  const toMin = (s) => { const p = s.split(':'); return +p[0] * 60 + +p[1]; };
  const winText = () => CONFIG.WINDOWS.map((w) => `${w.label} ${w.start}~${w.end}`).join(', ');

  function ranking(db) {
    const per = {};
    db.records.forEach((r) => {
      const p = (per[r.userId] = per[r.userId] || { name: r.name, dept: r.dept, floors: 0, runs: 0 });
      p.floors += r.floors; p.runs += 1;
    });
    const individual = Object.values(per).sort((a, b) => b.floors - a.floors || a.name.localeCompare(b.name));
    individual.forEach((p, i) => (p.rank = i + 1));
    const teams = {};
    Object.values(db.users).forEach((u) => { (teams[u.dept] = teams[u.dept] || { dept: u.dept, floors: 0, members: 0 }).members++; });
    individual.forEach((p) => { if (teams[p.dept]) teams[p.dept].floors += p.floors; });
    const team = Object.values(teams)
      .map((t) => ({ ...t, avg: t.members ? Math.round((t.floors / t.members) * 10) / 10 : 0 }))
      .sort((a, b) => b.avg - a.avg);
    team.forEach((t, i) => (t.rank = i + 1));
    return { individual, team };
  }

  function openInfo(o) {
    const w = CONFIG.WINDOWS.find((x) => x.id === o.windowId);
    return { startMs: o.startMs, windowId: o.windowId, windowLabel: w ? w.label : '', maxSeconds: CONFIG.MAX_SECONDS };
  }
  function activeWindow(done, min) {
    if (CONFIG.DEMO_SKIP_TIME_RULES) { const w = CONFIG.WINDOWS.find((x) => done.indexOf(x.id) < 0); return w ? w.id : null; }
    const w = CONFIG.WINDOWS.find((x) => min >= toMin(x.start) && min <= toMin(x.end));
    return w ? w.id : null;
  }

  const demo = {
    check: () => ({ windows: CONFIG.WINDOWS }),
    register({ userId, name, dept }) {
      if (CONFIG.DEPARTMENTS.indexOf(dept) < 0) throw fail('BAD_INPUT', '계열사를 다시 선택해 주세요.');
      const db = load();
      if (!db.users[userId]) db.users[userId] = { userId, name, dept, createdAt: new Date().toISOString() };
      save(db);
      return { userId, name, dept };
    },
    me({ userId }) {
      const db = load();
      if (!db.users[userId]) throw fail('NO_USER', '참가 신청이 필요합니다.');
      const now = Date.now(), t = kst(now);
      const mine = db.records.filter((r) => r.userId === userId);
      const today = mine.filter((r) => r.date === t.date);
      const done = today.map((r) => r.window);
      const o = db.open[userId];
      return {
        serverNow: now, windows: CONFIG.WINDOWS, activeWindow: activeWindow(done, t.min), doneWindows: done,
        todayRuns: today.length, floors: mine.reduce((s, r) => s + r.floors, 0),
        todayFloors: today.reduce((s, r) => s + r.floors, 0),
        open: o && now - o.startMs <= CONFIG.MAX_SECONDS * 1000 ? openInfo(o) : null,
      };
    },
    start({ userId }) {
      const db = load();
      if (!db.users[userId]) throw fail('NO_USER', '참가 신청이 필요합니다.');
      const now = Date.now(), t = kst(now);
      const o = db.open[userId];
      if (o && now - o.startMs <= CONFIG.MAX_SECONDS * 1000) return { serverNow: now, open: openInfo(o), resumed: true };
      delete db.open[userId];
      const done = db.records.filter((r) => r.userId === userId && r.date === t.date).map((r) => r.window);
      const wid = activeWindow(done, t.min);
      if (!wid) {
        save(db);
        if (CONFIG.DEMO_SKIP_TIME_RULES) throw fail('WINDOW_DONE', '오늘 가능한 기록을 모두 완료했습니다.');
        throw fail('OUTSIDE_WINDOW', '지금은 챌린지 시간이 아닙니다.');
      }
      if (done.indexOf(wid) >= 0) { save(db); throw fail('WINDOW_DONE', '이 시간대 기록은 오늘 이미 완료했습니다.'); }
      db.open[userId] = { userId, startMs: now, windowId: wid };
      save(db);
      return { serverNow: now, open: openInfo(db.open[userId]), resumed: false };
    },
    cancel({ userId }) { const db = load(); delete db.open[userId]; save(db); return {}; },
    finish({ userId, endKey }) {
      if (endKey !== CONFIG.DEMO_END_KEY) throw fail('END_KEY_INVALID', '종료 QR이 올바르지 않거나 만료되었습니다.');
      const db = load();
      const o = db.open[userId];
      if (!o) throw fail('NO_OPEN_RUN', '진행 중인 기록이 없습니다. 1층 QR로 다시 시작해 주세요.');
      const now = Date.now();
      const dur = Math.round((now - o.startMs) / 1000);
      if (dur > CONFIG.MAX_SECONDS) { delete db.open[userId]; save(db); throw fail('RUN_EXPIRED', '시간이 너무 오래 지나 기록이 만료되었습니다. 다시 시작해 주세요.'); }
      const u = db.users[userId];
      const flags = dur < CONFIG.MIN_SECONDS ? ['너무빠름(' + dur + '초)'] : [];
      db.records.push({ id: now, date: kst(o.startMs).date, window: o.windowId, userId, name: u.name, dept: u.dept,
        startAt: new Date(o.startMs).toISOString(), endAt: new Date(now).toISOString(), durationSec: dur, floors: CONFIG.FLOORS_PER_RUN, flags: flags.join(' / ') });
      delete db.open[userId];
      save(db);
      return { floors: CONFIG.FLOORS_PER_RUN, durationSec: dur };
    },
    ranking: () => ranking(load()),
  };

  window.API = {
    isDemo: !CONFIG.API_URL,
    async call(action, payload = {}) {
      payload = { ...payload, key: (payload && payload.key) || ss('stair_key') }; // 1층 QR로 받은 입장키 자동 첨부
      if (!CONFIG.API_URL) {
        if (payload.key !== CONFIG.DEMO_ENTRY_KEY) throw fail('KEY_INVALID', '만료된 QR코드입니다.');
        return demo[action](payload);
      }
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 20000);
      let res;
      try {
        res = await fetch(CONFIG.API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // preflight 회피
          body: JSON.stringify({ action, ...payload }),
          signal: ctl.signal,
        });
      } catch (e) {
        throw fail('NETWORK', e.name === 'AbortError' ? '서버 응답이 없습니다. 잠시 후 다시 시도해 주세요.' : '네트워크 연결을 확인해 주세요.');
      } finally { clearTimeout(timer); }
      let j;
      try { j = await res.json(); }
      catch (_) { throw fail('BAD_RESPONSE', '서버가 바빠 응답하지 못했습니다. 잠시 후 다시 시도해 주세요.'); }
      if (!j.ok) throw fail(j.code || 'SERVER', j.code === 'KEY_INVALID' ? '만료된 QR코드입니다.' : (j.error || '서버 오류'));
      return j.data;
    },
  };
})();
