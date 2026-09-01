// 직장인으로 살아남기 — 밸런스 시뮬레이터
// 방법론 §6-1: DOM 없이 순수 로직만 복제. 파라미터 x 전략 매트릭스 전수 실행
'use strict';

const r2 = n => Math.round(n * 100) / 100;

// ─────────────────────────────────────────────────────────────
// 파라미터 (여기가 조절 대상)
// ─────────────────────────────────────────────────────────────
let P;
const DEFAULT = {
  P: 3.0,                       // 시간당 처리량
  배정: [40, 48, 56, 64],       // 사원/계장/대리/책임
  승진일: [0, 8, 16, 24],       // 근속일 기준 (0-indexed 직급 전환일)
  취침M: 5, 취침H: 4,
  피로계수: 0.015,              // 소모 x (1 + day*k)   시간연동 페널티
  배정증가: 0.01,               // 배정 x (1 + day*k)
  시작금: 30000,
  주급: 100000,
  월세: 70000,
  약값: 10000, 담배값: 8000,
  약효과H: 40, 담배효과M: 40,   // 아이템 회복량
  지각확률: 0.25,
  발각확률: 0.25,
  선행한도: 1,
  아이템상한: 99,             // 구매 정책상 유지 개수
  SP율: 1,                    // 하루당 SP
  월세임계: 3,                // 월세 못 냄 N회 -> 백수
  총경고임계: 3,              // 총 경고 N회 -> 짤림
};
const RESET = o => { P = Object.assign({}, DEFAULT, o || {}); };

// ─────────────────────────────────────────────────────────────
// 블록 / 선택지 정의  (안 C: 업무만 시간비례, 게이지는 블록별 고정값)
//   m=멘탈 h=건강 money=돈 work=처리시간(P 곱함) caught=발각판정 late=지각판정
// ─────────────────────────────────────────────────────────────
const BLOCKS = {
  출근준비: { hours: 2, ch: {
    커피:      { m: +15, h:  -1, money: -5000, work: 0 },
    바로출근:  { m:  -3, h:  +1, money:      0, work: 1 },
    더자기:    { m: +15, h: +15, money:      0, work: 0, late: true },
  }},
  오전업무: { hours: 3, ch: {
    일하기:      { m: -10, h:  -5, work: 3 },
    일하는척:    { m:  -4, h:  -1, work: 0, caught: true },
    대놓고놀기:  { m:  +6, h:   0, work: 0, caught: true },
    몰래부업:    { m:  -6, h:  -3, money: +9000, work: 0, caught: true },
    운동:        { m:   0, h:  +7, work: 0, need: '헬창' },
  }},
  점심: { hours: 1, ch: {
    점심먹기:    { m:  +5, h:  +5, money: -7000, work: 0 },
    자리에서:    { m:  -4, h:  +1, money: -3000, work: 0.5 },
    굶고일하기:  { m: -10, h: -10, work: 1 },
    점심부업:    { m:  -4, h:  -3, money: +3000, work: 0 },
  }},
  오후업무: { hours: 5, ch: {
    일하기:      { m: -18, h:  -9, work: 5 },
    일하는척:    { m:  -7, h:  -2, work: 0, caught: true },
    대놓고놀기:  { m:  +9, h:   0, work: 0, caught: true },
    몰래부업:    { m: -10, h:  -5, money: +15000, work: 0, caught: true },
    운동:        { m:   0, h: +11, work: 0, need: '헬창' },
  }},
  퇴근: { hours: 1, ch: {
    집가기:  { m:  +2, h:   0, work: 0 },
    야근:    { m: -25, h: -25, work: 5, eatsEvening: true },
  }},
  저녁: { hours: 5, ch: {
    저녁부업:  { m:  -7, h:  -7, money: +15000 },
    놀기:      { m: +10, h:   0 },
    운동:      { m:   0, h: +10 },
  }},
  주말: { hours: 5, ch: {
    부업:      { m:  -7, h:  -7, money: +15000 },
    알바:      { m: -10, h: -18, money: +25000 },
    잔업:      { m:  -8, h:  -8, work: 5 },
    놀기:      { m: +12, h:   0 },
    운동:      { m:   0, h: +12 },
    팀원전화:  { m: -10, card: +1, need: '일대신해줌' },
    기도:      { m: +25, money: -5000, need: '주말예배' },
  }},
};

// ─────────────────────────────────────────────────────────────
// 스킬 — 레벨 -> 효과 배율
// ─────────────────────────────────────────────────────────────
const emptySkills = () => ({
  일잘러:0, 일대신해줌:0, 짬처리:0, 사내정치:0, 임원진급:0,
  ai사용:0, 팀원강화:0, 칼퇴문화:0,
  MZ사원:0, 재빠른손:0, 알바n잡:0, 자는척:0, 무지출챌린지:0,
  모니터:0, SNS개설:0, 멀티태스킹:0,
  약담배효율:0, 단골:0, 약제조:0, 약판매:0, 다크웹:0,
  규칙적인생활:0, 주말은쉬는날:0, 운동하기:0, 달리기:0, 헬창:0,
  기도하기:0, 일기쓰기:0, 주말예배:0,
});

const SK = {
  처리량:      s => P.P + s.일잘러 * 0.9,
  배정배율:    s => 1 - s.팀원강화 * 0.15,
  일멘탈배율:  s => 1 - s.ai사용 * 0.18,
  건강배율:    s => 1 - s.짬처리 * 0.18,
  야근배율:    s => 1 - s.칼퇴문화 * 0.30,
  부업멘탈배율:s => 1 - s.MZ사원 * 0.15,
  부업수입:    s => 1 + s.재빠른손 * 0.20 + s.SNS개설 * 0.50,
  알바수입:    s => 1 + s.재빠른손 * 0.20 + s.알바n잡 * 0.25,
  발각방어:    s => s.모니터 / 4,          // Lv0=0, Lv3=0.75... Lv3에서 100% 되게 보정
  지각방어:    s => s.달리기 / 3,
  취침배율:    s => 1 + s.규칙적인생활 * 0.30,
  주말배율:    s => 1 + s.주말은쉬는날 * 0.40,
  저녁배율:    s => 1 + s.일기쓰기 * 0.25,
  운동배율:    s => 1 + s.운동하기 * 0.30,
  아침멘탈:    s => s.기도하기 * 6,
  월급배율:    s => 1 + s.사내정치 * 0.25 + s.임원진급 * 0.50 + s.팀원강화 * 0.15
                    + s.일대신해줌 * 0.08,
  월세배율:    s => 1 - s.무지출챌린지 * 0.30,
  카드최대:    s => s.일대신해줌,
};

// ─────────────────────────────────────────────────────────────
// 상태
// ─────────────────────────────────────────────────────────────
function newState(skills) {
  return {
    m: 100, h: 100, work: 0, money: P.시작금,
    day: 1, dow: 1,               // dow 1~5 평일, 6~7 주말
    warn: 0, wm: 0, wh: 0, wk: 0, wmoney: 0,
    약: 0, 담배: 0, card: 0,
    sp: 0, dead: null,
    skills,
    log: [], reWork: 0, maxMoney: 0,
    stat: { 야근: 0, 경고이벤트: 0, 아이템방어: 0, 발각: 0, 지각: 0 },
  };
}

const rank = s => {
  const d = s.day;
  if (d > P.승진일[3]) return 3;
  if (d > P.승진일[2]) return 2;
  if (d > P.승진일[1]) return 1;
  return 0;
};

// ─────────────────────────────────────────────────────────────
// 경고 처리
// ─────────────────────────────────────────────────────────────
function checkGauges(s, rnd) {
  // 멘탈 0
  if (s.m <= 0 && !s.dead) {
    if (s.담배 > 0) { s.담배--; s.m = Math.min(100, s.m + P.담배효과M * (1 + s.skills.약담배효율 * 0.3)); s.stat.아이템방어++; }
    else {
      s.warn++; s.wm++; s.m = 100; s.stat.경고이벤트++;
      if (s.wm >= 3) s.dead = '퇴사';
      else if (s.warn >= P.총경고임계) s.dead = '짤림';
    }
  }
  // 건강 0
  if (s.h <= 0 && !s.dead) {
    if (s.약 > 0) { s.약--; s.h = Math.min(100, s.h + P.약효과H * (1 + s.skills.약담배효율 * 0.3)); s.stat.아이템방어++; }
    else {
      s.warn++; s.wh++; s.h = 100; s.stat.경고이벤트++;
      if (s.wh >= 3) s.dead = '아사';
      else if (s.warn >= P.총경고임계) s.dead = '짤림';
    }
  }
}

function applyChoice(s, blockName, chName, rnd) {
  const B = BLOCKS[blockName];
  const c = B.ch[chName];
  if (!c) throw new Error('no choice ' + blockName + '/' + chName);
  const sk = s.skills;

  // 업무 처리
  if (c.work) {
    let p = SK.처리량(sk) * c.work;
    // 선행처리 한도: 오늘 배정 + 한도만큼만 처리 가능
    const cap = s.work + P.선행한도 * P.배정[rank(s)] * SK.배정배율(sk) * (1 + s.day * P.배정증가);
    s.work = Math.max(s.work - p, s.work - cap);
    if (s.work < -P.선행한도 * P.배정[rank(s)]) s.work = -P.선행한도 * P.배정[rank(s)];
  }
  // 멀티태스킹: 몰래부업 중에도 처리
  if (chName === '몰래부업' && sk.멀티태스킹 > 0) {
    s.work -= SK.처리량(sk) * B.hours * (sk.멀티태스킹 * 0.2);
  }

  // 게이지
  let dm = c.m || 0, dh = c.h || 0;
  if (dm < 0) {
    if (chName === '일하기' || chName === '굶고일하기' || chName === '자리에서') dm *= SK.일멘탈배율(sk);
    if (chName.includes('부업') || chName === '알바') dm *= SK.부업멘탈배율(sk);
    if (chName === '야근') dm *= SK.야근배율(sk);
  }
  if (dh < 0) {
    dh *= SK.건강배율(sk);
    if (chName === '야근') dh *= SK.야근배율(sk);
  }
  if (dm > 0 && blockName === '저녁') dm *= SK.저녁배율(sk);
  if (dh > 0 && chName === '운동') dh *= SK.운동배율(sk);
  if (blockName === '주말' && (dm > 0 || dh > 0)) { dm *= SK.주말배율(sk); dh *= SK.주말배율(sk); }

  const fatigue = 1 + s.day * P.피로계수;
  if (dm < 0) dm *= fatigue;
  if (dh < 0) dh *= fatigue;
  s.m = Math.min(100, s.m + dm);
  s.h = Math.min(100, s.h + dh);

  // 돈
  if (c.money) {
    let mo = c.money;
    if (mo > 0) {
      if (chName.includes('부업')) mo *= SK.부업수입(sk);
      if (chName === '알바') mo *= SK.알바수입(sk);
    }
    s.money += mo;
  }
  if (c.card) s.card = Math.min(SK.카드최대(sk), s.card + c.card);

  // 지각 판정
  if (c.late) {
    const def = Math.min(1, SK.지각방어(sk));
    if (rnd() < P.지각확률 * (1 - def)) {
      s.stat.지각++;
      s.warn++; // 강제회복 없는 순손해
      s.late = true;
      if (s.warn >= P.총경고임계) s.dead = '짤림';
    }
  }
  // 발각 판정
  if (c.caught) {
    const def = sk.모니터 >= 3 ? 1 : sk.모니터 / 4 + 0.25 * 0; // Lv1=0.5 Lv2=0.75 Lv3=1
    const d = [0, 0.5, 0.75, 1][sk.모니터] || 0;
    if (rnd() < P.발각확률 * (1 - d)) {
      s.stat.발각++;
      s.warn++;
      if (s.warn >= P.총경고임계) s.dead = '짤림';
    }
  }

  checkGauges(s, rnd);
}

// ─────────────────────────────────────────────────────────────
// 하루 진행
// ─────────────────────────────────────────────────────────────
function runWeekday(s, policy, rnd) {
  const sk = s.skills;
  s.late = false;
  // 아침 자동 멘탈회복 (기도하기)
  s.m = Math.min(100, s.m + SK.아침멘탈(sk));

  applyChoice(s, '출근준비', policy('출근준비', s), rnd);
  if (s.dead) return;

  // 업무 배정
  s.work += P.배정[rank(s)] * SK.배정배율(sk) * (1 + s.day * P.배정증가);

  // 오전 (지각 시 1h)
  const amHours = s.late ? 1 : 3;
  const amCh = policy('오전업무', s);
  if (s.late && amCh === '일하기') {
    // 3h -> 1h 처리
    s.work -= SK.처리량(sk) * 1;
    s.m += -6 * (1 / 3) * SK.일멘탈배율(sk);
    s.h += -3 * (1 / 3) * SK.건강배율(sk);
    checkGauges(s, rnd);
  } else {
    applyChoice(s, '오전업무', amCh, rnd);
  }
  if (s.dead) return;

  applyChoice(s, '점심', policy('점심', s), rnd);
  if (s.dead) return;
  applyChoice(s, '오후업무', policy('오후업무', s), rnd);
  if (s.dead) return;

  // 퇴근 판정
  let evening = true;
  if (s.work > 100) {
    if (s.card > 0) { s.card--; s.work -= 60; applyChoice(s, '퇴근', '집가기', rnd); }
    else {
      const pick = policy('퇴근이벤트', s);
      if (pick === '야근') { applyChoice(s, '퇴근', '야근', rnd); evening = false; s.stat.야근++; }
      else {
        s.warn++; s.wk++; s.work = 0; s.stat.경고이벤트++;
        if (s.wk >= 3) s.dead = '짤림';
        else if (s.warn >= P.총경고임계) s.dead = '짤림';
        applyChoice(s, '퇴근', '집가기', rnd);
      }
    }
  } else {
    const pick = policy('퇴근', s);
    applyChoice(s, '퇴근', pick, rnd);
    if (pick === '야근') { evening = false; s.stat.야근++; }
  }
  if (s.dead) return;

  if (evening) { applyChoice(s, '저녁', policy('저녁', s), rnd); if (s.dead) return; }

  // 취침
  s.m = Math.min(100, s.m + P.취침M * SK.취침배율(sk));
  s.h = Math.min(100, s.h + P.취침H * SK.취침배율(sk));
  s.sp += P.SP율;
}

function runWeekendDay(s, policy, rnd) {
  const sk = s.skills;
  s.m = Math.min(100, s.m + SK.아침멘탈(sk));
  // 토요일 정산
  if (s.dow === 6) {
    s.money += P.주급 * SK.월급배율(sk);
    const rent = P.월세 * SK.월세배율(sk);
    if (s.money >= rent) s.money -= rent;
    else {
      s.warn++; s.wmoney++; s.stat.경고이벤트++;
      if (s.wmoney >= P.월세임계) s.dead = '백수';
      else if (s.warn >= P.총경고임계) s.dead = '짤림';
    }
    if (s.dead) return;
    // 상점 (아이템 자동 구매 정책)
    buy(s);
  }
  for (let b = 0; b < 3; b++) {
    applyChoice(s, '주말', policy('주말', s), rnd);
    if (s.dead) return;
  }
  s.m = Math.min(100, s.m + P.취침M * SK.취침배율(sk));
  s.h = Math.min(100, s.h + P.취침H * SK.취침배율(sk));
  s.sp += P.SP율;
}

// 아이템 자동 구매 — 남는 돈의 절반까지 약·담배를 균형 구매
function buy(s) {
  const disc = 1 - s.skills.단골 * 0.15;
  const 약 = P.약값 * disc, 담 = P.담배값 * disc;
  let budget = s.money * 0.5;
  let guard = 0;
  while (budget >= Math.min(약, 담) && guard++ < 200) {
    if (s.약 >= P.아이템상한 && s.담배 >= P.아이템상한) break;
    if (s.약 <= s.담배 && s.약 < P.아이템상한 && budget >= 약) { s.약++; s.money -= 약; budget -= 약; }
    else if (s.담배 < P.아이템상한 && budget >= 담) { s.담배++; s.money -= 담; budget -= 담; }
    else break;
  }
  // 약 제조: 주말마다 무료 생성
  if (s.skills.약제조 > 0) s.약 += s.skills.약제조 + s.skills.다크웹;
}

function run(skills, policy, seed, maxDays) {
  const rnd = mulberry(seed);
  const s = newState(skills);
  maxDays = maxDays || 100;
  while (!s.dead && s.day <= maxDays) {
    if (s.dow <= 5) runWeekday(s, policy, rnd);
    else runWeekendDay(s, policy, rnd);
    if (s.money > s.maxMoney) s.maxMoney = s.money;
    if (s.dead) break;
    s.day++; s.dow = s.dow === 7 ? 1 : s.dow + 1;
  }
  if (!s.dead) s.dead = '생존(만기)';
  return s;
}

function mulberry(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// ─────────────────────────────────────────────────────────────
// 전략 (policy)
// ─────────────────────────────────────────────────────────────
const POLICIES = {
  워커홀릭: (blk, s) => ({
    출근준비: '바로출근', 오전업무: '일하기', 점심: '굶고일하기',
    오후업무: '일하기', 퇴근: '야근', 퇴근이벤트: '야근', 저녁: '운동',
    주말: s.work > 40 ? '잔업' : '알바',
  }[blk]),

  균형: (blk, s) => {
    switch (blk) {
      case '출근준비': return s.m < 40 ? '더자기' : '커피';
      case '오전업무': return s.m < 30 ? '대놓고놀기' : '일하기';
      case '점심':     return s.m < 50 || s.h < 50 ? '점심먹기' : '자리에서';
      case '오후업무': return s.m < 30 ? '대놓고놀기' : '일하기';
      case '퇴근':     return s.work > 60 && s.m > 45 && s.h > 45 ? '야근' : '집가기';
      case '퇴근이벤트': return (s.m > 30 && s.h > 30) ? '야근' : '집가기';
      case '저녁':     return s.m < 50 ? '놀기' : (s.h < 50 ? '운동' : '저녁부업');
      case '주말':     return s.m < 50 ? '놀기' : (s.h < 50 ? '운동' : (s.work > 40 ? '잔업' : '알바'));
    }
  },

  농땡이: (blk, s) => ({
    출근준비: '더자기', 오전업무: '대놓고놀기', 점심: '점심먹기',
    오후업무: '대놓고놀기', 퇴근: '집가기', 퇴근이벤트: '집가기', 저녁: '놀기',
    주말: '놀기',
  }[blk]),

  부업러: (blk, s) => ({
    출근준비: '커피', 오전업무: '몰래부업', 점심: '점심부업',
    오후업무: '몰래부업', 퇴근: '집가기', 퇴근이벤트: '야근', 저녁: '저녁부업',
    주말: '부업',
  }[blk]),

  회복러: (blk, s) => ({
    출근준비: '더자기', 오전업무: '일하기', 점심: '점심먹기',
    오후업무: '일하기', 퇴근: '집가기', 퇴근이벤트: '집가기',
    저녁: s.m < s.h ? '놀기' : '운동',
    주말: s.m < s.h ? '놀기' : '운동',
  }[blk]),
};

// ─────────────────────────────────────────────────────────────
// 빌드 (스킬 조합)
// ─────────────────────────────────────────────────────────────
const build = o => Object.assign(emptySkills(), o);
const BUILDS = {
  '무스킬(1회차)': build({}),
  '자기관리기본4': build({ 규칙적인생활: 3, 주말은쉬는날: 1 }),
  '업무기본6':     build({ 일잘러: 3, 일대신해줌: 3 }),
  '업무-팀장12':   build({ 일잘러: 3, 일대신해줌: 3, ai사용: 3, 팀원강화: 1, 칼퇴문화: 1, 연금: 1 }),
  '업무-사장12':   build({ 일잘러: 3, 일대신해줌: 3, 짬처리: 3, 사내정치: 1, 임원진급: 1 }),
  '부업-크리12':   build({ MZ사원: 3, 재빠른손: 1, 모니터: 3, SNS개설: 1, 멀티태스킹: 3 }),
  '부업-백수12':   build({ MZ사원: 3, 재빠른손: 1, 알바n잡: 3, 자는척: 3, 무지출챌린지: 1 }),
  '아이템-검은손12': build({ 약담배효율: 3, 단골: 1, 약제조: 3, 약판매: 3, 다크웹: 1 }),
  '자기관리-운동12': build({ 규칙적인생활: 3, 주말은쉬는날: 1, 운동하기: 3, 달리기: 3, 헬창: 1 }),
  '자기관리-기도12': build({ 규칙적인생활: 3, 주말은쉬는날: 1, 기도하기: 3, 일기쓰기: 3, 주말예배: 1 }),
};

// ─────────────────────────────────────────────────────────────
// 실행
// ─────────────────────────────────────────────────────────────
function avg(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }

function trial(skills, policy, n) {
  const days = [], deaths = {}, warns = [], sps = [], defs = [], moneys = [];
  for (let i = 0; i < n; i++) {
    const s = run(skills, policy, 1000 + i * 7);
    days.push(s.day); warns.push(s.warn); sps.push(s.sp);
    defs.push(s.stat.아이템방어); moneys.push(s.maxMoney);
    deaths[s.dead] = (deaths[s.dead] || 0) + 1;
  }
  const top = Object.entries(deaths).sort((a, b) => b[1] - a[1]);
  return { day: r2(avg(days)), warn: r2(avg(warns)), sp: r2(avg(sps)),
           def: r2(avg(defs)), money: Math.round(avg(moneys)), deaths: top };
}

function table(title, rows, cols) {
  console.log('\n== ' + title + ' ==');
  const w = cols.map((c, i) => Math.max(c.length, ...rows.map(r => String(r[i]).length)));
  console.log(cols.map((c, i) => c.padEnd(w[i])).join(' | '));
  console.log(w.map(x => '-'.repeat(x)).join('-+-'));
  rows.forEach(r => console.log(r.map((v, i) => String(v).padEnd(w[i])).join(' | ')));
}

const N = 40;

// 실험 1: 무스킬 × 전략별 1회차 생존
RESET();
{
  const rows = [];
  for (const [pn, pol] of Object.entries(POLICIES)) {
    const t = trial(BUILDS['무스킬(1회차)'], pol, N);
    rows.push([pn, t.day, t.warn, t.sp, t.deaths.map(d => d[0] + ':' + d[1]).join(' ')]);
  }
  table('실험1  무스킬 1회차 · 전략별 (n=' + N + ')', rows, ['전략', '생존일', '경고', 'SP', '배드엔딩 분포']);
}

// 실험 2: 빌드별 (균형 전략)
{
  const rows = [];
  for (const [bn, sk] of Object.entries(BUILDS)) {
    const t = trial(sk, POLICIES.균형, N);
    rows.push([bn, t.day, t.warn, t.sp, t.deaths.map(d => d[0] + ':' + d[1]).join(' ')]);
  }
  table('실험2  빌드별 · 균형 전략 (n=' + N + ')', rows, ['빌드', '생존일', '경고', 'SP', '배드엔딩 분포']);
}

// 실험 3: 파라미터 스윕 (배정량 x P) — 무스킬 균형
{
  const rows = [];
  for (const base of [30, 35, 40, 45, 50]) {
    for (const pp of [2.5, 3.0, 3.5]) {
      RESET({ 배정: [base, base * 1.2, base * 1.4, base * 1.6], P: pp });
      const t = trial(BUILDS['무스킬(1회차)'], POLICIES.균형, N);
      rows.push(['배정' + base + ' P' + pp, t.day, t.warn, t.sp,
                 t.deaths.map(d => d[0] + ':' + d[1]).join(' ')]);
    }
  }
  table('실험3  파라미터 스윕 · 무스킬 균형 (n=' + N + ')', rows,
        ['파라미터', '생존일', '경고', 'SP', '배드엔딩 분포']);
}

RESET();
// 실험 4: 회차 누적 SP 곡선 (배드엔딩 반복 · 빌드를 점점 강화)
{
  const ladder = [
    ['1회차', BUILDS['무스킬(1회차)']],
    ['2회차', build({ 규칙적인생활: 3 })],
    ['3회차', build({ 규칙적인생활: 3, 주말은쉬는날: 1, 일잘러: 2 })],
    ['4회차', build({ 규칙적인생활: 3, 주말은쉬는날: 1, 일잘러: 3, ai사용: 2 })],
    ['5회차', BUILDS['업무-팀장12']],
    ['6회차', build({ 규칙적인생활: 3, 주말은쉬는날: 1, 일잘러: 3, 일대신해줌: 3, ai사용: 3, 팀원강화: 1, 칼퇴문화: 1 })],
  ];
  const rows = []; let cum = 0;
  for (const [n, sk] of ladder) {
    const t = trial(sk, POLICIES.균형, N);
    cum += t.sp;
    rows.push([n, t.day, t.sp, r2(cum), t.deaths.map(d => d[0] + ':' + d[1]).join(' ')]);
  }
  table('실험4  회차 진행 · SP 누적 곡선', rows, ['회차', '생존일', '획득SP', '누적SP', '배드엔딩']);
}

// 실험 5: 압도 빌드 검증 (모니터3 + 멀티태스킹3)
{
  const rows = [];
  const cands = {
    '균형(무스킬)': [BUILDS['무스킬(1회차)'], POLICIES.균형],
    '크리12+부업러': [BUILDS['부업-크리12'], POLICIES.부업러],
    '크리12+균형':   [BUILDS['부업-크리12'], POLICIES.균형],
    '팀장12+균형':   [BUILDS['업무-팀장12'], POLICIES.균형],
    '운동12+균형':   [BUILDS['자기관리-운동12'], POLICIES.균형],
    '검은손12+균형': [BUILDS['아이템-검은손12'], POLICIES.균형],
  };
  for (const [n, [sk, pol]] of Object.entries(cands)) {
    const t = trial(sk, pol, N);
    rows.push([n, t.day, t.sp, t.warn, t.deaths.map(d => d[0] + ':' + d[1]).join(' ')]);
  }
  table('실험5  12SP 빌드 비교 (압도 여부)', rows, ['빌드+전략', '생존일', 'SP', '경고', '배드엔딩']);
}


// 실험 6: 압도 빌드 진단 — 아이템 방어 횟수/잔액
RESET();
{
  const rows = [];
  const cands = {
    '무스킬+균형':   [BUILDS['무스킬(1회차)'], POLICIES.균형],
    '크리12+부업러': [BUILDS['부업-크리12'], POLICIES.부업러],
    '팀장12+균형':   [BUILDS['업무-팀장12'], POLICIES.균형],
  };
  for (const [n, [sk, pol]] of Object.entries(cands)) {
    const t = trial(sk, pol, N);
    rows.push([n, t.day, t.def, t.warn, t.money.toLocaleString(), t.deaths.map(d => d[0]+':'+d[1]).join(' ')]);
  }
  table('실험6  압도 빌드 진단 (아이템방어 = 경고를 안 쓴 횟수)', rows,
        ['빌드+전략','생존일','아이템방어','경고','최종잔액','배드엔딩']);
}

// 실험 7: 아이템 가격 스윕 — 압도가 아이템 무한구매 탓인지
{
  const rows = [];
  for (const price of [10000, 30000, 60000, 100000]) {
    RESET({ 약값: price, 담배값: Math.round(price*0.8) });
    const a = trial(BUILDS['부업-크리12'], POLICIES.부업러, N);
    const b = trial(BUILDS['무스킬(1회차)'], POLICIES.균형, N);
    rows.push(['약'+price, a.day, a.def, b.day, b.def,
               a.deaths.map(d=>d[0]+':'+d[1]).join(' ')]);
  }
  table('실험7  아이템 가격 스윕', rows,
        ['가격','크리12생존','방어','무스킬생존','방어','크리12 배드엔딩']);
}

// 실험 8: 아이템 보유 상한 스윕
{
  const rows = [];
  for (const cap of [1, 2, 3, 5, 99]) {
    RESET({ 아이템상한: cap });
    const a = trial(BUILDS['부업-크리12'], POLICIES.부업러, N);
    const b = trial(BUILDS['무스킬(1회차)'], POLICIES.균형, N);
    rows.push(['상한'+cap, a.day, a.def, b.day, b.def,
               a.deaths.map(d=>d[0]+':'+d[1]).join(' ')]);
  }
  table('실험8  아이템 보유 상한 스윕', rows,
        ['상한','크리12생존','방어','무스킬생존','방어','크리12 배드엔딩']);
}

// 실험 9: SP 정책 — 1회차에 트리 완주(12SP)가 가능한가
{
  RESET();
  const rows = [];
  for (const rate of [1, 0.5, 0.34, 0.25]) {
    RESET({ SP율: rate });
    const t = trial(BUILDS['무스킬(1회차)'], POLICIES.균형, N);
    const w = trial(BUILDS['무스킬(1회차)'], POLICIES.워커홀릭, N);
    rows.push([rate + '/일', t.day, t.sp, w.sp, t.sp >= 12 ? '완주가능(문제)' : 'OK']);
  }
  table('실험9  SP 획득률 — 1회차 트리완주(12SP) 차단 여부', rows,
        ['SP율','균형생존일','균형SP','워커홀릭SP','1회차 완주']);
}

// 실험 10: 월세/주급 비율 — 백수 엔딩이 나오는가
{
  const rows = [];
  for (const rent of [70000, 90000, 110000, 130000]) {
    RESET({ 월세: rent, 약값: 30000, 담배값: 24000 });
    const b = trial(BUILDS['무스킬(1회차)'], POLICIES.균형, N);
    const r = trial(BUILDS['무스킬(1회차)'], POLICIES.회복러, N);
    rows.push(['월세'+rent, b.day, b.money.toLocaleString(),
               b.deaths.map(d=>d[0]+':'+d[1]).join(' '),
               r.deaths.map(d=>d[0]+':'+d[1]).join(' ')]);
  }
  table('실험10  월세 스윕 (주급 10만 고정) · 약 3만', rows,
        ['월세','균형생존일','최종잔액','균형 배드엔딩','회복러 배드엔딩']);
}

// 실험 11: 최종안 검증 — 약3만 + SP 0.5 + 월세조정
{
  const FINAL = { 약값: 30000, 담배값: 24000, SP율: 0.5, 월세: 110000 };
  RESET(FINAL);
  const rows = [];
  for (const [pn, pol] of Object.entries(POLICIES)) {
    const t = trial(BUILDS['무스킬(1회차)'], pol, N);
    rows.push([pn, t.day, t.warn, t.sp, t.def, t.deaths.map(d=>d[0]+':'+d[1]).join(' ')]);
  }
  table('실험11-A  최종안 · 무스킬 1회차 전략별', rows,
        ['전략','생존일','경고','SP','아이템방어','배드엔딩']);

  const rows2 = [];
  for (const [bn, sk] of Object.entries(BUILDS)) {
    const t = trial(sk, POLICIES.균형, N);
    rows2.push([bn, t.day, t.warn, t.sp, t.deaths.map(d=>d[0]+':'+d[1]).join(' ')]);
  }
  table('실험11-B  최종안 · 빌드별 (균형)', rows2, ['빌드','생존일','경고','SP','배드엔딩']);

  const rows3 = [];
  const cands = {
    '크리12+부업러': [BUILDS['부업-크리12'], POLICIES.부업러],
    '백수12+균형':   [BUILDS['부업-백수12'], POLICIES.균형],
    '검은손12+균형': [BUILDS['아이템-검은손12'], POLICIES.균형],
    '팀장12+균형':   [BUILDS['업무-팀장12'], POLICIES.균형],
    '사장12+워커홀릭':[BUILDS['업무-사장12'], POLICIES.워커홀릭],
    '운동12+균형':   [BUILDS['자기관리-운동12'], POLICIES.균형],
    '기도12+균형':   [BUILDS['자기관리-기도12'], POLICIES.균형],
  };
  for (const [n, [sk, pol]] of Object.entries(cands)) {
    const t = trial(sk, pol, N);
    rows3.push([n, t.day, t.sp, t.def, t.deaths.map(d=>d[0]+':'+d[1]).join(' ')]);
  }
  table('실험11-C  최종안 · 12SP 빌드 압도 검증', rows3,
        ['빌드+전략','생존일','SP','아이템방어','배드엔딩']);

  // 회차 누적
  const ladder = [
    ['1회차 무스킬', BUILDS['무스킬(1회차)']],
    ['2회차 규칙3',  build({ 규칙적인생활: 3 })],
    ['3회차 +주말1+일잘러2', build({ 규칙적인생활:3, 주말은쉬는날:1, 일잘러:2 })],
    ['4회차 +ai2',   build({ 규칙적인생활:3, 주말은쉬는날:1, 일잘러:3, ai사용:2 })],
    ['5회차 팀장12', BUILDS['업무-팀장12']],
  ];
  const rows4 = []; let cum = 0;
  for (const [n, sk] of ladder) {
    const t = trial(sk, POLICIES.균형, N);
    cum += t.sp;
    rows4.push([n, t.day, t.sp, r2(cum), t.deaths.map(d=>d[0]+':'+d[1]).join(' ')]);
  }
  table('실험11-D  최종안 · SP 누적 곡선 (12SP 트리 완주까지)', rows4,
        ['회차','생존일','획득SP','누적SP','배드엔딩']);
}

// 실험 12: 월세 > 주급 — 부업/알바를 강제해야 백수 축이 살아나는가
{
  const rows = [];
  for (const rent of [110000, 140000, 170000, 200000]) {
    RESET({ 약값:30000, 담배값:24000, SP율:0.5, 월세: rent });
    const b = trial(BUILDS['무스킬(1회차)'], POLICIES.균형, N);
    const r = trial(BUILDS['무스킬(1회차)'], POLICIES.회복러, N);
    const w = trial(BUILDS['무스킬(1회차)'], POLICIES.워커홀릭, N);
    rows.push(['월세'+(rent/10000)+'만', b.day, b.money.toLocaleString(),
               b.deaths.map(d=>d[0]+':'+d[1]).join(' '),
               r.deaths.map(d=>d[0]+':'+d[1]).join(' '),
               w.deaths.map(d=>d[0]+':'+d[1]).join(' ')]);
  }
  table('실험12  월세 > 주급(10만) 스윕', rows,
        ['월세','균형생존','잔액','균형엔딩','회복러엔딩','워커홀릭엔딩']);
}

// 실험 13: 월세못냄 임계 2회 안
{
  const rows = [];
  for (const rent of [110000, 140000, 170000]) {
    RESET({ 약값:30000, 담배값:24000, SP율:0.5, 월세: rent, 월세임계: 2 });
    const b = trial(BUILDS['무스킬(1회차)'], POLICIES.균형, N);
    const r = trial(BUILDS['무스킬(1회차)'], POLICIES.회복러, N);
    rows.push(['월세'+(rent/10000)+'만·임계2', b.day,
               b.deaths.map(d=>d[0]+':'+d[1]).join(' '),
               r.deaths.map(d=>d[0]+':'+d[1]).join(' ')]);
  }
  table('실험13  월세못냄 임계 2회', rows, ['설정','균형생존','균형엔딩','회복러엔딩']);
}

// 실험 14: 배정량 하향 — 짤림 편중 완화되는가
{
  const rows = [];
  for (const base of [30, 34, 38, 42]) {
    RESET({ 약값:30000, 담배값:24000, SP율:0.5, 월세:170000,
            배정:[base, base*1.2, base*1.4, base*1.6] });
    const b = trial(BUILDS['무스킬(1회차)'], POLICIES.균형, N);
    const r = trial(BUILDS['무스킬(1회차)'], POLICIES.회복러, N);
    const f = trial(BUILDS['무스킬(1회차)'], POLICIES.부업러, N);
    rows.push(['배정'+base, b.day, b.sp,
               b.deaths.map(d=>d[0]+':'+d[1]).join(' '),
               r.deaths.map(d=>d[0]+':'+d[1]).join(' '),
               f.deaths.map(d=>d[0]+':'+d[1]).join(' ')]);
  }
  table('실험14  배정량 스윕 (월세17만 고정)', rows,
        ['배정','균형생존','SP','균형엔딩','회복러엔딩','부업러엔딩']);
}

// ══ 최종 확정안 검증 ══
const FINAL = { 약값:30000, 담배값:24000, SP율:0.5, 월세:140000, 월세임계:2 };
{
  RESET(FINAL);
  console.log('\n\n########## 최종 확정안 ##########');
  console.log(JSON.stringify(Object.assign({}, DEFAULT, FINAL), null, 0).replace(/,/g, ', '));

  const rows = [];
  for (const [pn, pol] of Object.entries(POLICIES)) {
    const t = trial(BUILDS['무스킬(1회차)'], pol, 60);
    rows.push([pn, t.day, t.warn, t.sp, t.deaths.map(d=>d[0]+':'+d[1]).join(' ')]);
  }
  table('최종-A  무스킬 1회차 · 전략별 (n=60)', rows, ['전략','생존일','경고','SP','배드엔딩']);

  const rows2 = [];
  const cands = {
    '무스킬':        [BUILDS['무스킬(1회차)'], POLICIES.균형],
    '업무-팀장12':   [BUILDS['업무-팀장12'], POLICIES.균형],
    '업무-사장12':   [BUILDS['업무-사장12'], POLICIES.균형],
    '부업-크리12':   [BUILDS['부업-크리12'], POLICIES.부업러],
    '부업-백수12':   [BUILDS['부업-백수12'], POLICIES.균형],
    '아이템-검은손12':[BUILDS['아이템-검은손12'], POLICIES.균형],
    '자기관리-운동12':[BUILDS['자기관리-운동12'], POLICIES.균형],
    '자기관리-기도12':[BUILDS['자기관리-기도12'], POLICIES.균형],
  };
  for (const [n, [sk, pol]] of Object.entries(cands)) {
    const t = trial(sk, pol, 60);
    rows2.push([n, t.day, t.sp, t.def, t.deaths.map(d=>d[0]+':'+d[1]).join(' ')]);
  }
  table('최종-B  12SP 빌드 비교 (n=60)', rows2, ['빌드','생존일','SP','아이템방어','배드엔딩']);

  const ladder = [
    ['1회차 무스킬',   BUILDS['무스킬(1회차)']],
    ['2회차 규칙3',    build({ 규칙적인생활:3 })],
    ['3회차 +주말1+일잘러2', build({ 규칙적인생활:3, 주말은쉬는날:1, 일잘러:2 })],
    ['4회차 +일잘러3+ai2',  build({ 규칙적인생활:3, 주말은쉬는날:1, 일잘러:3, ai사용:2 })],
    ['5회차 팀장12',   BUILDS['업무-팀장12']],
    ['6회차 팀장12+자기관리4', build({ 일잘러:3, 일대신해줌:3, ai사용:3, 팀원강화:1, 칼퇴문화:1, 규칙적인생활:3, 주말은쉬는날:1 })],
  ];
  const rows3 = []; let cum = 0;
  for (const [n, sk] of ladder) {
    const t = trial(sk, POLICIES.균형, 60);
    cum += t.sp;
    rows3.push([n, t.day, t.sp, r2(cum), t.deaths.map(d=>d[0]+':'+d[1]).join(' ')]);
  }
  table('최종-C  SP 누적 곡선', rows3, ['회차','생존일','획득SP','누적SP','배드엔딩']);
}

// 실험 15: 빌드별 "엔딩 돈 조건 500,000" 도달 가능성
{
  RESET({ 약값:30000, 담배값:24000, SP율:0.5, 월세:140000, 월세임계:2 });
  const 돈전략 = (blk, s) => {
    switch (blk) {
      case '출근준비': return s.m < 40 ? '더자기' : '커피';
      case '오전업무': return s.m < 30 ? '대놓고놀기' : '일하기';
      case '점심':     return s.m < 50 || s.h < 50 ? '점심먹기' : '굶고일하기';
      case '오후업무': return s.m < 30 ? '대놓고놀기' : '일하기';
      case '퇴근':     return s.work > 60 && s.m > 45 && s.h > 45 ? '야근' : '집가기';
      case '퇴근이벤트': return (s.m > 30 && s.h > 30) ? '야근' : '집가기';
      case '저녁':     return s.m < 40 ? '놀기' : (s.h < 40 ? '운동' : '저녁부업');
      case '주말':     return s.m < 40 ? '놀기' : (s.h < 35 ? '운동' : '알바');
    }
  };
  const rows = [];
  const cands = {
    '무스킬':          BUILDS['무스킬(1회차)'],
    '업무-팀장12':     BUILDS['업무-팀장12'],
    '업무-사장12':     BUILDS['업무-사장12'],
    '부업-크리12':     BUILDS['부업-크리12'],
    '부업-백수12':     BUILDS['부업-백수12'],
    '아이템-검은손12': BUILDS['아이템-검은손12'],
    '자기관리-운동12': BUILDS['자기관리-운동12'],
    '자기관리-기도12': BUILDS['자기관리-기도12'],
  };
  for (const [n, skl] of Object.entries(cands)) {
    const t = trial(skl, 돈전략, 60);
    rows.push([n, t.day, t.sp, t.money.toLocaleString(),
               t.money >= 500000 ? 'O' : 'X',
               t.deaths.map(d => d[0]+':'+d[1]).join(' ')]);
  }
  table('실험15  돈 중시 전략 · 엔딩 조건 500,000 도달 여부', rows,
        ['빌드','생존일','SP','최고보유액','50만도달','배드엔딩']);
}
