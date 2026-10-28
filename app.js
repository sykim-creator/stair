(function () {
  const $ = (id) => document.getElementById(id);
  const RUN_KEY = 'stair_run';          // 진행 중인 기록(이 기기에만 보관): 앱이 꺼졌다 켜져도 이어가기 위함
  const PREFIX = 'STAIR-END:';          // 종료 QR 내용 형식
  const VIEWS = ['gate', 'done', 'join', 'home', 'run', 'scan', 'rank'];

  let user = null, openRun = null, offset = 0, timer = null, mode = 'ind';
  let windows = CONFIG.WINDOWS, busy = false, cancelArmed = 0, homeActive = null;
  let stream = null, scanning = false, scanTimer = 0, lastBad = 0;

  // ---------- 저장소 (실패해도 앱은 동작) ----------
  const store = {
    get() { try { return JSON.parse(localStorage.getItem(RUN_KEY) || 'null'); } catch (_) { return null; } },
    set(v) { try { localStorage.setItem(RUN_KEY, JSON.stringify(v)); } catch (_) {} },
    clear() { try { localStorage.removeItem(RUN_KEY); } catch (_) {} },
  };
  const sget = (k) => { try { return sessionStorage.getItem(k) || ''; } catch (_) { return ''; } };
  const sset = (k, v) => { try { sessionStorage.setItem(k, v); } catch (_) {} };
  const sdel = (k) => { try { sessionStorage.removeItem(k); } catch (_) {} };

  $('evName').textContent = CONFIG.EVENT_NAME;
  $('evPeriod').textContent = CONFIG.EVENT_PERIOD + (API.isDemo ? '  (데모 모드)' : '');
  CONFIG.DEPARTMENTS.forEach((d) => $('dept').add(new Option(d, d)));

  // ---------- 화면 전환 ----------
  function show(v) {
    VIEWS.forEach((k) => $('v-' + k).classList.toggle('hidden', k !== v));
    $('nav').classList.toggle('hidden', !(v === 'home' || v === 'run' || v === 'rank'));
    document.querySelectorAll('nav button').forEach((b) =>
      b.classList.toggle('on', b.dataset.v === (v === 'run' ? 'home' : v)));
    if (v === 'rank') loadRank();
  }
  document.querySelectorAll('nav button').forEach((b) => (b.onclick = () => {
    if (!user) return;
    show(b.dataset.v === 'home' ? (openRun ? 'run' : 'home') : b.dataset.v);
    if (b.dataset.v === 'home' && !openRun) sync();
  }));

  const msg = (el, text, cls) => { el.className = 'msg ' + (cls || ''); el.textContent = text; };
  const fmt = (sec) => {
    sec = Math.max(0, Math.floor(sec));
    return String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
  };
  const elapsed = () => (openRun ? (Date.now() + offset - openRun.startMs) / 1000 : 0);
  function drawTime() { if (openRun) { $('runTime').textContent = fmt(elapsed()); $('scanTime').textContent = fmt(elapsed()); } }
  function startClock() { clearInterval(timer); drawTime(); timer = setInterval(drawTime, 1000); }
  function stopClock() { clearInterval(timer); timer = null; }

  function failView(e, el) { // 공통 오류 처리
    if (e && e.code === 'KEY_INVALID') return expired();
    msg(el, (e && e.message) || '오류가 발생했습니다.', 'err');
  }

  // ---------- 참가 신청 ----------
  $('btnJoin').onclick = async () => {
    const name = $('name').value.trim().replace(/\s+/g, ' '), dept = $('dept').value;
    const m = $('joinMsg');
    if (!name) return msg(m, '이름을 입력해 주세요.', 'err');
    $('btnJoin').disabled = true;
    try {
      const userId = dept + '|' + name; // 로그인 ID = 계열사 + 이름
      const reg = await API.call('register', { userId, name, dept });
      user = { userId: reg.userId || userId, name: reg.name || name, dept: reg.dept || dept };
      await enter();
    } catch (e) { failView(e, m); }
    $('btnJoin').disabled = false;
  };

  // 로그인/재접속 직후: 서버 상태를 읽어 진행 중이면 이어서, 아니면 메인으로
  async function refresh() {
    const me = await API.call('me', { userId: user.userId });
    offset = me.serverNow - Date.now();
    if (me.windows) windows = me.windows;
    openRun = me.open || null;
    return me;
  }
  async function enter() {
    const me = await refresh();
    if (openRun) { store.set({ user, key: sget('stair_key') }); enterRun(); }
    else { store.clear(); renderHome(me); show('home'); }
  }
  async function sync() { // 화면 복귀 시 최신화
    if (!user || busy || stream) return;
    try {
      const me = await refresh();
      if (openRun) { if ($('v-home').classList.contains('hidden') === false) enterRun(); drawTime(); }
      else if (!$('v-run').classList.contains('hidden') || !$('v-scan').classList.contains('hidden')) {
        store.clear(); stopClock(); renderHome(me); show('home');
        msg($('homeMsg'), '진행 중이던 기록이 만료되어 종료되었습니다. 다시 시작해 주세요.', 'err');
      } else renderHome(me);
    } catch (e) { if (e && e.code === 'KEY_INVALID') expired(); }
  }

  // ---------- 메인 (시작 전) ----------
  function renderHome(me) {
    $('who').textContent = `${user.name} · ${user.dept}`;
    const box = $('winList'); box.textContent = '';
    windows.forEach((w) => {
      const done = (me.doneWindows || []).indexOf(w.id) >= 0, active = me.activeWindow === w.id;
      const d = document.createElement('div');
      d.className = 'win' + (done ? ' done' : '') + (active && !done ? ' active' : '');
      const b = document.createElement('b'); b.textContent = w.label;
      const t = document.createElement('div'); t.textContent = `${w.start}~${w.end}`;
      const s = document.createElement('small'); s.textContent = done ? '✅ 완료' : active ? '지금 가능' : '대기';
      d.append(b, t, s); box.append(d);
    });
    homeActive = me.activeWindow || null;
    const done = me.activeWindow && (me.doneWindows || []).indexOf(me.activeWindow) >= 0;
    $('btnStart').disabled = !me.activeWindow || done;
    $('btnStart').classList.remove('hidden');
    if (!me.activeWindow) {
      msg($('homeMsg'), '지금은 챌린지 시간이 아닙니다.');
    } else if (done) {
      msg($('homeMsg'), '이 시간대 기록은 이미 완료했습니다. 다음 시간대에 다시 도전해 주세요.', 'ok');
    } else {
      $('homeMsg').className = 'msg';
      $('homeMsg').innerHTML = '1층에서 시작 버튼을 누르고 10층까지 올라간 뒤,<br>10층의 <b>종료 QR</b>을 스캔하면 기록이 저장됩니다.';
    }
    $('myTotal').textContent = me.floors; $('myToday').textContent = me.todayFloors;
    API.call('ranking').then((r) => {
      const p = r.individual.find((x) => x.name === user.name && x.dept === user.dept);
      $('myRank').textContent = p ? p.rank + '위' : '-';
    }).catch(() => {});
  }

  $('btnStart').onclick = async () => {
    if (busy) return; busy = true; $('btnStart').disabled = true;
    try {
      const r = await API.call('start', { userId: user.userId });
      offset = r.serverNow - Date.now(); openRun = r.open;
      store.set({ user, key: sget('stair_key') });
      enterRun();
      busy = false;
    } catch (e) {
      busy = false;
      if (e && e.code === 'KEY_INVALID') return expired();
      await sync(); // 화면을 최신 상태로 다시 그린 뒤 사유를 표시
      msg($('homeMsg'), e.message, 'err');
    }
  };

  // ---------- 진행 중 ----------
  function enterRun() {
    $('runWho').textContent = `${user.name} · ${user.dept}`;
    $('runWin').textContent = (openRun.windowLabel || '') + ' 시간대 기록 중';
    msg($('runMsg'), '');
    resetCancel();
    startClock();
    show('run');
  }
  $('btnStop').onclick = () => { setScanState('prompt'); msg($('scanMsg'), ''); show('scan'); };

  function resetCancel() { clearTimeout(cancelArmed); cancelArmed = 0; $('btnCancel').textContent = '시작 취소'; }
  $('btnCancel').onclick = async () => {
    if (!cancelArmed) { // 실수 방지: 한 번 더 눌러야 취소
      $('btnCancel').textContent = '정말 취소할까요? 한 번 더 누르세요';
      cancelArmed = setTimeout(resetCancel, 4000);
      return;
    }
    resetCancel();
    try {
      await API.call('cancel', { userId: user.userId });
      stopClock(); openRun = null; store.clear();
      await enter();
    } catch (e) { failView(e, $('runMsg')); }
  };

  // ---------- 종료 QR 스캔 ----------
  function setScanState(s) {
    $('scanPrompt').classList.toggle('hidden', s !== 'prompt');
    $('scanCam').classList.toggle('hidden', s !== 'cam');
  }
  $('btnBackRun').onclick = () => { stopCamera(); show('run'); };
  $('btnCloseCam').onclick = () => { stopCamera(); setScanState('prompt'); msg($('scanMsg'), ''); };

  async function openCamera() {
    const m = $('scanMsg');
    if (!window.isSecureContext || !(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) {
      return msg(m, '이 환경에서는 카메라를 열 수 없습니다. 휴대폰 기본 브라우저(사파리/크롬)로 이 페이지를 열어 주세요.', 'err');
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false,
      });
    } catch (e) {
      const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      return msg(m, denied
        ? '카메라 권한이 허용되지 않았습니다. 브라우저(주소창/설정)에서 이 사이트의 카메라를 허용해 주세요.'
        : '카메라를 열 수 없습니다. 휴대폰 기본 브라우저(사파리/크롬)로 다시 열어 주세요.', 'err');
    }
    const v = $('video');
    v.srcObject = stream; v.setAttribute('playsinline', ''); v.muted = true;
    try { await v.play(); } catch (_) {}
    msg(m, '');
    setScanState('cam');
    scanning = true; scanTick();
  }
  $('btnOpenCam').onclick = openCamera;

  function stopCamera() {
    scanning = false; clearTimeout(scanTimer);
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
    const v = $('video'); try { v.pause(); } catch (_) {} v.srcObject = null;
  }
  function scanTick() {
    if (!scanning) return;
    const v = $('video');
    if (v.readyState >= 2 && v.videoWidth) {
      const code = decode(v, v.videoWidth, v.videoHeight, 640, 'dontInvert');
      if (code && Date.now() - lastBad > 1500 && !onCode(code)) lastBad = Date.now();
    }
    scanTimer = setTimeout(scanTick, 100);
  }
  function decode(src, sw, sh, maxW, inv) {
    const c = $('grab'), ctx = c.getContext('2d', { willReadFrequently: true });
    const scale = Math.min(1, maxW / sw);
    const w = Math.max(1, Math.round(sw * scale)), h = Math.max(1, Math.round(sh * scale));
    c.width = w; c.height = h;
    ctx.drawImage(src, 0, 0, w, h);
    const r = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: inv });
    return r && r.data ? r.data : null;
  }

  function onCode(raw) { // 반환: 종료 QR 형식이면 true
    if (busy) return true;
    if (String(raw).indexOf(PREFIX) !== 0) {
      msg($('scanMsg'), '종료 QR이 아닙니다. 10층에 부착된 종료 QR을 스캔해 주세요.', 'err');
      return false;
    }
    finishWith(String(raw).slice(PREFIX.length).trim());
    return true;
  }

  async function finishWith(endKey) {
    if (busy) return; busy = true;
    stopCamera(); setScanState('prompt'); msg($('scanMsg'), '저장 중…');
    try {
      const r = await API.call('finish', { userId: user.userId, endKey });
      const dur = r.durationSec != null ? r.durationSec : elapsed();
      logout(r.floors, dur);
    } catch (e) {
      if (e.code === 'KEY_INVALID') expired();
      else if (e.code === 'NO_OPEN_RUN' || e.code === 'RUN_EXPIRED') {
        msg($('scanMsg'), e.message, 'err');
        stopClock(); openRun = null; store.clear();
        setTimeout(() => enter().catch(() => {}), 2500);
      } else msg($('scanMsg'), e.message + (/^END_KEY/.test(e.code || '') ? '' : ' — 다시 스캔해 주세요.'), 'err');
    }
    busy = false;
  }

  function logout(floors, dur) {
    stopClock(); stopCamera();
    doneKey = sget('stair_key'); // 완료 화면의 랭킹 조회용으로 메모리에만 보관(새로고침하면 사라짐)
    store.clear(); sdel('stair_key');
    openRun = null; doneUser = user; user = null;
    $('name').value = '';
    $('doneFloors').textContent = floors;
    $('doneMsg').textContent = '소요 시간 ' + fmt(dur);
    $('doneRank').textContent = ''; doneMode = 'ind'; setDoneTabs();
    show('done'); loadDoneRank();
    window.scrollTo(0, 0);
  }

  // ---------- 랭킹 ----------
  $('tabInd').onclick = () => { mode = 'ind'; setTabs(); loadRank(); };
  $('tabTeam').onclick = () => { mode = 'team'; setTabs(); loadRank(); };
  $('btnRefresh').onclick = loadRank;
  function setTabs() {
    $('tabInd').classList.toggle('on', mode === 'ind');
    $('tabTeam').classList.toggle('on', mode === 'team');
  }
  const medal = (n) => ['🥇', '🥈', '🥉'][n - 1] || n;
  function row(rank, title, sub, val, me) {
    const d = document.createElement('div');
    d.className = 'rank-row' + (me ? ' me' : '');
    d.innerHTML = '<div class="rank-no"></div><div class="rank-info"><b></b><br><small></small></div><div class="rank-val"></div>';
    d.children[0].textContent = medal(rank);
    d.querySelector('b').textContent = title;
    d.querySelector('small').textContent = sub;
    d.children[2].textContent = val;
    return d;
  }
  function renderRank(box, r, m, who, limit) {
    box.textContent = '';
    if (m === 'ind') {
      if (!r.individual.length) box.textContent = '아직 기록이 없습니다.';
      r.individual.slice(0, limit).forEach((p) =>
        box.append(row(p.rank, p.name, `${p.dept} · ${p.runs}회 완료`, p.floors + '층',
          who && p.name === who.name && p.dept === who.dept)));
    } else {
      if (!r.team.length) box.textContent = '아직 기록이 없습니다.';
      r.team.forEach((t) =>
        box.append(row(t.rank, t.dept, `참가 ${t.members}명 · 합계 ${t.floors}층`, '평균 ' + t.avg + '층',
          who && t.dept === who.dept)));
    }
  }
  async function loadRank() {
    const box = $('rankList');
    box.textContent = '불러오는 중…';
    try { renderRank(box, await API.call('ranking'), mode, user, 50); }
    catch (e) {
      if (e.code === 'KEY_INVALID') return expired();
      box.textContent = '불러오기 실패: ' + e.message;
    }
  }

  // 기록 저장 완료 화면 아래의 랭킹 (저장 직후 로그아웃 상태이므로 방금 참가자 정보를 따로 보관)
  let doneUser = null, doneMode = 'ind', doneKey = null;
  function setDoneTabs() {
    $('dTabInd').classList.toggle('on', doneMode === 'ind');
    $('dTabTeam').classList.toggle('on', doneMode === 'team');
  }
  async function loadDoneRank() {
    const box = $('dRankList');
    box.textContent = '불러오는 중…';
    try {
      const r = await API.call('ranking', { key: doneKey });
      renderRank(box, r, doneMode, doneUser, 30);
      const p = doneUser && r.individual.find((x) => x.name === doneUser.name && x.dept === doneUser.dept);
      $('doneRank').textContent = p ? `현재 내 순위 ${p.rank}위 · 누적 ${p.floors}층` : '';
    } catch (e) { box.textContent = '랭킹을 불러오지 못했습니다: ' + e.message; }
  }
  $('dTabInd').onclick = () => { doneMode = 'ind'; setDoneTabs(); loadDoneRank(); };
  $('dTabTeam').onclick = () => { doneMode = 'team'; setDoneTabs(); loadDoneRank(); };
  $('dBtnRefresh').onclick = loadDoneRank;

  // ---------- 만료된(교체된) QR ----------
  function expired() {
    stopClock(); stopCamera(); busy = false;
    sdel('stair_key');
    user = null; openRun = null;
    $('gateTitle').textContent = '만료된 QR코드입니다.';
    $('gateMsg').textContent = store.get()
      ? '1층 계단 입구의 QR코드를 다시 스캔해 주세요. 진행 중이던 기록이 이어집니다.'
      : '1층 계단 입구의 QR코드를 스캔해 주세요.';
    show('gate');
  }

  // ---------- 시작 ----------
  // 1층 QR 주소(?k=입장키)로 들어오면 키를 이 탭에 보관하고 주소창에서는 지움
  const qk = new URLSearchParams(location.search).get('k');
  if (qk) {
    sset('stair_key', qk);
    history.replaceState(null, '', location.pathname);
    const sv = store.get(); if (sv) { sv.key = qk; store.set(sv); } // 진행 중 기록이 있으면 새 키로 갱신
  } else {
    const sv = store.get();
    if (sv && sv.key && !sget('stair_key')) sset('stair_key', sv.key); // 앱이 다시 열려도 진행 중 기록은 이어감
  }
  if (!sget('stair_key')) {
    show('gate');
  } else {
    API.call('check').then(async (info) => {
      if (info && info.windows) windows = info.windows;
      const sv = store.get();
      if (sv && sv.user) {
        user = sv.user;
        try { await enter(); }
        catch (e) {
          if (e && e.code === 'KEY_INVALID') return expired();
          store.clear(); user = null; show('join');
          if (e && e.code !== 'NO_USER') msg($('joinMsg'), e.message, 'err');
        }
      } else show('join');
    }).catch((e) => {
      if (e && e.code === 'KEY_INVALID') return expired();
      show('join'); msg($('joinMsg'), '서버 연결을 확인해 주세요: ' + e.message, 'err');
    });
  }

  // 메인 화면을 켜 둔 채 시간대가 바뀌면(시작/종료 시각 도달) 자동으로 버튼 상태를 갱신 (한국시간 기준, 서버 시각 보정)
  function localActiveWindow() {
    const k = new Date(Date.now() + offset + 9 * 3600 * 1000);
    const min = k.getUTCHours() * 60 + k.getUTCMinutes();
    const tm = (s) => { const p = s.split(':'); return +p[0] * 60 + +p[1]; };
    const w = windows.find((x) => min >= tm(x.start) && min <= tm(x.end));
    return w ? w.id : null;
  }
  setInterval(() => {
    if (!user || busy || stream || $('v-home').classList.contains('hidden')) return;
    if (API.isDemo && CONFIG.DEMO_SKIP_TIME_RULES) return;
    if (localActiveWindow() !== homeActive) sync();
  }, 10000);

  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync(); });
})();
