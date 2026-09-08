/* ══════════════════════════════════════════════════════════════
   직장인으로 살아남기 — 밸런스 검증 하네스
   ══════════════════════════════════════════════════════════════

   실행:  node sim.js            전체
          node sim.js check      정합성 검사만
          node sim.js solo       트리별 단독 엔딩만

   ── 설계 (2026-09-02 전면 교체) ──────────────────────────────
   이전 sim.js 는 게임 로직을 손으로 복제한 별도 구현이었다.
   index.html 을 고칠 때마다 같이 고쳐야 했고, 실제로 두 번 조용히 어긋났다
   (완주 SP 11 기준으로 남아 있었고, 해금 게이트가 아예 없었다).

   그래서 복제를 버리고 index.html 의 <script> 를 그대로 실행한다.
   DOM 을 최소한으로 흉내내고 클릭 핸들러를 가로채 이벤트를 흘려보낸다.
   -> 게임을 고쳐도 이 파일은 고칠 필요가 없다. 어긋날 수가 없다.
   ══════════════════════════════════════════════════════════════ */

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const HTML = path.join(__dirname, 'index.html');
const SEED = 20260902;

const r2 = n => Math.round(n * 100) / 100;

/* ── 1. 하네스 ───────────────────────────────────────────── */

function mulberry(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function 게임로드(seed) {
  const code = fs.readFileSync(HTML, 'utf8').match(/<script>([\s\S]*)<\/script>/)[1];
  const 핸들러 = [];
  const 저장소 = {};
  const el = () => ({
    innerHTML: '', textContent: '', style: {}, dataset: {},
    classList: { add() {}, remove() {}, contains() { return false; } },
    querySelector: () => null, querySelectorAll: () => [], appendChild() {}, remove() {},
  });

  const M2 = Object.create(Math);
  M2.random = mulberry(seed);

  const ctx = {
    console,
    Math: M2, JSON, Date, Object, Array, String, Number, Boolean,
    isNaN, parseInt, parseFloat, confirm: () => true,
    document: {
      getElementById: el, querySelector: () => null, querySelectorAll: () => [],
      createElement: el, head: el(), addEventListener: (t, f) => 핸들러.push(f),
    },
    localStorage: {
      getItem: k => (k in 저장소 ? 저장소[k] : null),
      setItem: (k, v) => { 저장소[k] = String(v); },
      removeItem: k => { delete 저장소[k]; },
    },
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  // 게임 스크립트의 const 선언은 스크립트 스코프라 ctx 속성이 되지 않는다.
  // 같은 스코프에서 한 줄을 덧붙여 내부 정의를 꺼낸다.
  const 내보내기 = '\n;window.__sim = { TREE, CFG, M, CH, SHOP, sk, curBlock, sellPrice, gateOk, 계열SP, 전체SP };';
  vm.runInContext(code + 내보내기, ctx, { filename: 'index.html' });
  Object.assign(ctx, ctx.window.__sim);

  // 클릭 = dataset 을 가진 버튼을 눌렀다고 알린다
  const 클릭 = ds => {
    const btn = { dataset: ds, disabled: false };
    const ev = { target: { closest: () => btn } };
    핸들러.forEach(h => h(ev));
  };

  ctx.window.__game.dev(true);          // 하네스 실행은 GA 로 보내지 않는다
  return { g: ctx.window.__game, ctx, 클릭 };
}

/* ── 2. 조작 헬퍼 ────────────────────────────────────────── */

// 게임 시작 (시작화면 -> 새로하기)
const 새게임 = H => H.클릭({ title: 'new' });

// 스킬을 직접 세팅 — "그 트리를 완주한 상태" 를 만든다 (SP 소비 없음)
function 완주세팅(H, 계열, 서브) {
  const c = H.ctx.TREE.find(x => x.계열 === 계열);
  c.구간.forEach(g => {
    if (g.nm === '기본' || g.tree === 서브)
      g.nodes.forEach(n => { if (!n.end) H.g.state.skills[n.id] = n.max; });
  });
}

// 이벤트 팝업이 떠 있으면 처리 (활성화된 마지막 선택지)
function 팝업처리(H) {
  const S = H.g.state;
  if (S.phase !== 'event' || !S.ev) return false;
  const opts = S.ev.opts;
  let idx = -1;
  for (let i = 0; i < opts.length; i++) if (!opts[i].need || opts[i].need()) idx = i;
  if (idx < 0) return false;
  H.클릭({ ev: String(idx) });
  return true;
}

// 게이지가 낮으면 보유 아이템 사용
function 아이템사용(H) {
  const S = H.g.state;
  if (S.phase !== 'play') return false;
  if (S.h < 40 && S.items['약'] > 0) { H.클릭({ use: '약' }); return true; }
  if (S.m < 40 && S.items['담배'] > 0) { H.클릭({ use: '담배' }); return true; }
  if (S.work > 85 && S.items['AI'] > 0) { H.클릭({ use: 'AI' }); return true; }
  return false;
}

/* ── 3. 플레이 정책 ──────────────────────────────────────── */
/* 게이지를 보고 고른다. 자동플레이는 사람보다 못하므로
   여기 수치는 "최소 보장선" 으로 읽는다. */

function 선택(H) {
  const S = H.g.state;
  const 이름 = H.g.choices().map(c => c.k);
  if (!이름.length) return -1;
  const f = (...ns) => { for (const n of ns) { const i = 이름.indexOf(n); if (i >= 0) return i; } return -1; };
  const b = H.ctx.curBlock();
  let i = -1;
  if (b === '출근준비')             i = S.h < 55 ? f('한약', '커피 사먹기') : (S.m < 55 ? f('커피 사먹기') : -1);
  else if (b.indexOf('업무') === 0) i = f('일하기');
  else if (b === '점심')            i = (S.m < 45 || S.h < 45) ? f('점심 먹기') : f('자리에서 먹고 일하기');
  else if (b === '퇴근')            i = (S.work > 55 && S.m > 45 && S.h > 45) ? f('야근하기') : f('집가기');
  else if (b === '저녁')            i = S.m < 45 ? f('놀기') : (S.h < 45 ? f('운동하기', '놀기') : f('알바하기', '부업하기', '놀기'));
  else                              i = (S.m < 45 || S.h < 45) ? f('놀기', '운동하기', '기도하기') : f('알바하기', '부업하기', '잔업하기');
  if (i < 0 && b === '출근준비') i = f('바로 출근하기');
  return i >= 0 ? i : 0;
}

// 한 회차를 끝까지
function 한판(H, 최대일) {
  최대일 = 최대일 || 200;
  const S = H.g.state;
  let 최고돈 = S.money, 엔딩도달일 = null, guard = 0;
  while (S.phase !== 'ending' && S.day <= 최대일 && guard++ < 20000) {
    if (팝업처리(H)) continue;
    if (아이템사용(H)) continue;
    const i = 선택(H);
    if (i < 0) break;
    H.클릭({ ci: String(i) });
    if (S.money > 최고돈) {
      최고돈 = S.money;
      if (엔딩도달일 === null && 최고돈 >= H.ctx.CFG.엔딩돈) 엔딩도달일 = S.day;
    }
  }
  return { 일: S.day, 최고돈, 엔딩도달일,
           사인: S.over ? S.over.name : '(만기)', sp: Math.floor(S.bank + S.earned) };
}

/* ── 4. 정합성 검사 ──────────────────────────────────────── */
/* 이번 세션에 실제로 터진 결함 유형을 회귀 검사로 고정한다.
   6개 중 4개는 2026-09-02 에 실제로 발생했던 것이다. */

function 정합성검사() {
  const H = 게임로드(SEED);
  새게임(H);
  const { TREE, CH, M, SHOP } = H.ctx;
  const 실패 = [];
  const chk = (ok, msg) => { if (!ok) 실패.push(msg); };

  // (1) 8개 서브트리의 완주 SP 가 모두 같은가
  const 완주 = [];
  TREE.forEach(c => {
    const base = c.구간.find(g => g.nm === '기본');
    const b = base.nodes.filter(n => !n.end).reduce((t, n) => t + n.max, 0);
    c.구간.filter(g => g.tree).forEach(g => {
      const s = g.nodes.filter(n => !n.end).reduce((t, n) => t + n.max, 0);
      완주.push({ 서브: g.tree, sp: b + s });
    });
  });
  const 기준 = 완주[0].sp;
  chk(완주.every(x => x.sp === 기준),
      '완주 SP 불일치: ' + 완주.map(x => x.서브 + '=' + x.sp).join(' '));

  // (2) 선택지가 참조하는 스킬 id 가 실존하는가
  //     -> '주말예배' vs '주말 예배' 오타로 기도하기가 영구 미해금이었던 건 재발 방지
  const 실존 = new Set();
  TREE.forEach(c => c.구간.forEach(g => g.nodes.forEach(n => 실존.add(n.id))));
  Object.keys(CH).forEach(k => CH[k].forEach(c => {
    if (c.need) chk(실존.has(c.need),
      '선택지 [' + c.k + '] need "' + c.need + '" 가 스킬 목록에 없음');
    if (c.gate && c.gate.skill) chk(실존.has(c.gate.skill),
      '선택지 [' + c.k + '] gate.skill "' + c.gate.skill + '" 가 스킬 목록에 없음');
  }));

  // (3) 모든 스킬 max 에서 감산형 배율이 0 이하가 되지 않는가
  //     -> 레벨 상한을 올리면 1 - k*lv 가 음수가 되어 소모가 회복이 된다
  TREE.forEach(c => c.구간.forEach(g => g.nodes.forEach(n => {
    if (!n.end) H.g.state.skills[n.id] = n.max;
  })));
  ['배정배율', '일멘탈배율', '건강배율', '야근배율', '부업멘탈배율',
   '월세배율', '상점할인', '알바건강배율', '지출배율'].forEach(k => {
    const v = typeof M[k] === 'function' ? M[k]() : null;
    chk(v !== null && v > 0, k + ' = ' + r2(v) + ' — 0 이하면 소모가 회복이 된다');
  });

  // (4) 방어형(배열)은 최고 레벨에서 100% 인가
  //     -> 배열 길이를 안 늘리고 max 만 올리면 undefined -> 0% 로 조용히 떨어진다
  chk(M.발각방어() === 1, '사생활 보호 모니터 max 인데 발각방어 = ' + M.발각방어());
  chk(M.지각방어() === 1, '달리기 max 인데 지각방어 = ' + M.지각방어());

  // (5) 판매가 < 구매가 인가 (상점 왕복만으로 무한 수익 방지)
  ['약', '담배'].forEach(id => {
    const base = SHOP.find(x => x.id === id).price;
    const sell = H.ctx.sellPrice(id);
    chk(sell < base, id + ' 판매가 ' + sell + ' >= 구매가 ' + base + ' — 무한 수익');
  });

  // (6) 딴짓 중 업무 처리량이 음수가 아닌가
  const 딴짓 = CH.업무.filter(c => c.slack || c.sneak);
  딴짓.forEach(c => chk(H.g.effect(c).work >= 0, '[' + c.k + '] 처리량이 음수'));

  return { 기준완주SP: 기준, 실패 };
}

/* ── 5. 실험 ─────────────────────────────────────────────── */

// A: 트리별 단독 엔딩 — 완주 상태로 시작해 엔딩 조건(완주 + 돈)에 닿는가
function 실험_단독엔딩() {
  const H0 = 게임로드(SEED);
  const 목록 = [];
  H0.ctx.TREE.forEach(c => c.구간.filter(g => g.tree).forEach(g => 목록.push([c.계열, g.tree])));

  return 목록.map(([계열, 서브], idx) => {
    const H = 게임로드(SEED + idx);
    새게임(H);
    완주세팅(H, 계열, 서브);
    const r = 한판(H);
    return [서브, r.일 + '일', r.최고돈.toLocaleString(),
            r.엔딩도달일 ? 'D' + r.엔딩도달일 : '미달', r.사인];
  });
}

// B: 1회차 (스킬 0) — 생존일 · 획득 SP · 배드엔딩 분포
function 실험_1회차(n) {
  n = n || 12;
  const out = [];
  for (let i = 0; i < n; i++) {
    const H = 게임로드(SEED + i * 977);
    새게임(H);
    out.push(한판(H));
  }
  const avg = k => Math.round(out.reduce((a, b) => a + b[k], 0) / out.length * 10) / 10;
  const 분포 = {};
  out.forEach(r => { 분포[r.사인] = (분포[r.사인] || 0) + 1; });
  return { 표본: n, 평균생존일: avg('일'), 평균SP: avg('sp'), 배드엔딩분포: 분포 };
}

// C: 완주 SP 까지 몇 회차 걸리나 (SP 는 회차를 넘어 누적된다)
function 실험_완주회차(목표SP) {
  const H = 게임로드(SEED + 31);
  새게임(H);
  let 회차 = 0, 누적 = 0;
  while (누적 < 목표SP && 회차 < 30) {
    회차++;
    const r = 한판(H);
    누적 = r.sp;
    if (H.g.state.phase !== 'ending') break;
    H.클릭({ re: '1' });                    // 환생 (SP 유지)
  }
  return { 목표SP, 회차, 누적SP: 누적 };
}

/* ── 6. 출력 ─────────────────────────────────────────────── */

const 폭 = s => [...String(s)].reduce((a, ch) => a + (ch.charCodeAt(0) > 0x2000 ? 2 : 1), 0);

function 표(제목, 헤더, rows) {
  const w = 헤더.map((h, i) => Math.max(폭(h), ...rows.map(r => 폭(r[i]))));
  const 줄 = r => '  ' + r.map((c, i) => String(c) + ' '.repeat(w[i] - 폭(c))).join('  ');
  console.log('\n' + 제목);
  console.log(줄(헤더));
  console.log('  ' + w.map(x => '-'.repeat(x)).join('  '));
  rows.forEach(r => console.log(줄(r)));
}

function main() {
  const mode = process.argv[2] || 'all';
  console.log('직장인으로 살아남기 — 밸런스 하네스');
  console.log('대상: index.html (실제 게임 코드를 그대로 구동)');
  console.log('시드: ' + SEED);

  let 완주SP = null;
  if (mode === 'all' || mode === 'check') {
    const c = 정합성검사();
    완주SP = c.기준완주SP;
    console.log('\n[정합성 검사]  완주 SP = ' + c.기준완주SP);
    if (c.실패.length === 0) console.log('  통과 — 6개 항목 이상 없음');
    else c.실패.forEach(m => console.log('  실패: ' + m));
  }

  if (mode === 'all' || mode === 'solo') {
    const rows = 실험_단독엔딩();
    표('[A] 트리별 단독 엔딩 — 완주 상태로 시작',
       ['서브트리', '생존', '최고 돈', '엔딩', '사인'], rows);
    console.log('\n  엔딩 도달: ' + rows.filter(r => r[3] !== '미달').length + ' / ' + rows.length);
  }

  if (mode === 'all') {
    const b = 실험_1회차();
    console.log('\n[B] 1회차 (스킬 0)');
    console.log('  표본 ' + b.표본 + '회 · 평균 생존 ' + b.평균생존일 + '일 · 평균 획득 SP ' + b.평균SP);
    console.log('  배드엔딩 분포: ' +
      Object.keys(b.배드엔딩분포).map(k => k + ' ' + b.배드엔딩분포[k]).join(' / '));

    const d = 실험_완주회차(완주SP);
    console.log('\n[C] 완주(SP ' + d.목표SP + ')까지');
    console.log('  ' + d.회차 + '회차 · 누적 SP ' + d.누적SP);
  }
  console.log('');
}

main();
