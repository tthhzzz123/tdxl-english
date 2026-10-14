/* 同等学力英语 · 学习台 v0.2 —— 纯前端离线可用；导航：今日 / 练习 / 资料 / 我的 */
const STATE_KEY = 'tdxl_state_v1';
const MODE_KEY = 'tdxl_word_mode';
let CONTENT = null, state = null;
let tab = 'today', subPractice = 'exam', subMaterials = 'grammar';
let planOpen = false;
let recordsOpen = false;
let pYear = null, pSection = '词汇题', pQuestions = [];
let makeOpts = { year: 'all', sec: '混合', n: 20 };   // 出题器：年份 × 题型 × 数量
let exam = null;                       // 当前考试：{name, qs, picks, startTs, timerId}
const SECTIONS = { '词汇题': [1, 10], '口语交际': [13, 22], '阅读理解': [23, 47], '完形填空': [48, 57], '短文完成': [58, 77] };
const SECTION_POINTS = { '口语交际': 1, '词汇题': 1, '阅读理解': 1, '完形填空': 1, '短文完成': 1 };   // 每题 1 分，合计 75

const $ = (s) => document.querySelector(s);
const view = () => document.getElementById('view');
const todayStr = () => new Date().toLocaleDateString('sv-SE');

function loadState() { try { return JSON.parse(localStorage.getItem(STATE_KEY)) || null; } catch (e) { return null; } }
function saveStateRaw() { localStorage.setItem(STATE_KEY, JSON.stringify(state)); }
function saveState() {                    // 存本机 + 顺手排一次"自动上云"
  saveStateRaw();
  if (typeof scheduleAutoSync === 'function') scheduleAutoSync();
}

/* ---------------- 云同步：改完自动传（0 操作），云端被别人改过就不覆盖 ---------------- */
let syncTimer = null, syncBusy = false;
function syncReady() {
  return !!(state && state.sync && state.sync.url && state.sync.key && state.sync.auto !== false);
}
function syncStatusText() {
  const s = (state && state.sync) || {};
  if (!s.url || !s.key) return '还没设置同步（填同步码就自动开了）';
  if (s.conflict) return '云端有更新（别的设备改过）→ 点「从云恢复」拿回来';
  if (s.pending) return '有改动待上传：联网后自动传（也可以点「上传到云」）';
  return s.lastSync ? '已自动同步 ' + s.lastSync : '已开启自动同步（有改动就自动传）';
}
function scheduleAutoSync() {
  if (state && state.sync && state.sync.url && state.sync.key) state.sync.pending = true;
  if (!syncReady()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { autoSync(); }, 8000);       // 停手 8 秒后自动补传
}
async function autoSync() {
  if (syncBusy || !syncReady() || (navigator.onLine === false)) return;
  syncBusy = true;
  try {
    const head = await fetch(state.sync.url, { cache: 'no-store',
      headers: { 'Authorization': 'Bearer ' + state.sync.key } });
    if (head.ok) {
      const j = await head.json();
      if (j.updatedAt && state.sync.lastSync && j.updatedAt !== state.sync.lastSync) {
        state.sync.conflict = true; syncBusy = false; saveStateRaw();
        if (tab === 'mine') renderMine();
        return;                                              // 云端更新 → 不覆盖，等用户选
      }
    }
    const r = await fetch(state.sync.url, { method: 'PUT', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + state.sync.key },
      body: JSON.stringify({ state: stripSync(state) }) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j2 = await r.json();
    state.sync.lastSync = j2.updatedAt || new Date().toLocaleString();
    state.sync.pending = false; state.sync.conflict = false;
    if (typeof fetchAnalysis === 'function') setTimeout(() => fetchAnalysis(false), 800);   // 传完顺手刷新分析
  } catch (e) {
    /* 离线 / 暂时连不上：留着 pending，下次打开或联网时再传 */
  }
  syncBusy = false;
  saveStateRaw();
  if (tab === 'mine') renderMine();
}
window.addEventListener('online', () => { autoSync(); });
function freshState() { return { days: {}, words: {}, answers: {}, created: new Date().toISOString() }; }
function stripSync(st) { const c = JSON.parse(JSON.stringify(st)); delete c.sync; return c; }
function daysToExam(d) {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((new Date(d + 'T00:00:00') - t) / 864e5));
}
function switchTab(name) {
  tab = name;
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  render();
}
const CN = (s) => String(s == null ? '' : s);

/* ---------------- 云同步地址：按站点自动选通道（自有域名上线后同源直连） ---------------- */
const LEGACY_SYNC = 'https://tdxl.tdxl-en.workers.dev/api/sync';
function isGithubPages() { return (location.hostname || '').endsWith('github.io'); }
function defaultSyncUrl() {
  if (location.protocol === 'file:' || !location.hostname) return '';
  if (isGithubPages()) return LEGACY_SYNC;          // 过渡通道（GitHub Pages 上只能跨域调 Worker）
  return location.origin + '/api/sync';             // 自有域名 / Worker 上同源直连
}
function fixSyncUrl() {
  if (!state || !state.sync || !state.sync.url) return;
  if (location.protocol === 'file:' || isGithubPages()) return;
  if (state.sync.url === LEGACY_SYNC) {             // 域名上线后自动把老地址换掉，无需手动改
    state.sync.url = location.origin + '/api/sync';
    saveState();
  }
}
function channelNote() {
  if (location.protocol === 'file:' || !location.hostname) return '本机文件模式：离线可用，不同步';
  if (isGithubPages()) return '当前是 GitHub 过渡通道（国内稳定可用），云同步地址将来会随自有域名自动切换';
  return '当前是自有域名通道：学习记录同源直连云同步';
}

/* ---------------- 学习活动记录（用于自动判定完成） ---------------- */
function todayAct() {
  state.activity = state.activity || {};
  const d = todayStr();
  state.activity[d] = state.activity[d] || { words: {}, read: {}, writing: {} };
  const a = state.activity[d];
  a.words = a.words || {}; a.read = a.read || {}; a.writing = a.writing || {};
  return a;
}
function todayAnswers() {
  const d = todayStr();
  return Object.entries(state.answers || {}).filter(([, r]) => r && r.ts && new Date(r.ts).toLocaleDateString('sv-SE') === d);
}
function actOf(date) {
  state.activity = state.activity || {};
  state.activity[date] = state.activity[date] || { words: {}, read: {}, writing: {} };
  const a = state.activity[date];
  a.words = a.words || {}; a.read = a.read || {}; a.writing = a.writing || {};
  return a;
}
function answersOn(date) {
  return Object.entries(state.answers || {}).filter(([, r]) =>
    r && r.ts && new Date(r.ts).toLocaleDateString('sv-SE') === date);
}
/** 自动判定某天某个任务的完成度：返回 {done, total, status} */
function taskProgressAt(date, t) {
  const act = actOf(date);
  const dayAns = answersOn(date);
  const ty = t['题型'] || t['类型'] || '';
  if (ty === '整卷模考') {
    const n = dayAns.length;
    return { done: Math.min(n, 75), total: 75, status: n === 0 ? 'todo' : n >= 75 ? 'ok' : 'doing' };
  }
  if (ty === '语法/考点') {
    const done = Object.keys(act.read).length;
    return { done: Math.min(done, 1), total: 1, status: done ? 'ok' : 'todo' };
  }
  if (ty === '翻译/写作') {
    const done = Object.keys(act.writing).length;
    return { done: Math.min(done, 1), total: 1, status: done ? 'ok' : 'todo' };
  }
  if (ty === '错题重做') {
    const wrong = wrongList().length;
    if (!wrong) return { done: 1, total: 1, status: 'ok' };
    const retried = Object.entries(state.answers || {}).filter(([, r]) =>
      r.retried && new Date(r.retried).toLocaleDateString('sv-SE') === date).length;
    return { done: Math.min(retried, wrong), total: wrong, status: retried >= wrong ? 'ok' : retried ? 'doing' : 'todo' };
  }
  const words = t['词表'] || [];
  if (words.length) {
    const done = words.filter((w) => act.words[String(w).toLowerCase()]).length;
    return { done, total: words.length, status: done >= words.length ? 'ok' : done ? 'doing' : 'todo' };
  }
  const sec = t['题型'] || '';
  if (sec && SECTIONS[sec]) {
    const need = t['题量'] || SECTIONS[sec][1] - SECTIONS[sec][0] + 1;
    const done = dayAns.filter(([qid]) => {
      const [y, no] = String(qid).split(':');
      const inYear = !t['年份'] || String(t['年份']) === y;
      const [lo, hi] = SECTIONS[sec] || [1, 999];
      return inYear && Number(no) >= lo && Number(no) <= hi;
    }).length;
    return { done: Math.min(done, need), total: need, status: done >= need ? 'ok' : done ? 'doing' : 'todo' };
  }
  return { done: 0, total: 0, status: 'none' };   // 休息/机动等不计入
}
function taskProgress(t) { return taskProgressAt(todayStr(), t); }

/* ---------------- 启动 ---------------- */
/* ---------------- 内容版本：后台改完计划/内容 → 手机一键更新 / 打开自动更新 ---------------- */
let updNote = '';
let lastAutoCheck = 0;
let analysis = null, analysisMsg = '', lastAnalysisAt = 0;
try { analysis = JSON.parse(localStorage.getItem('tdxl_analysis')) || null; } catch (e) { analysis = null; }
function analysisUrl() {
  const u = (state && state.sync && state.sync.url) || '';
  if (!u) return '';
  return /\/sync$/.test(u) ? u.replace(/\/sync$/, '/analysis') : u.replace(/\/[^/]*$/, '/analysis');
}
/** 拉云端分析：manual=true 时当场重算（?refresh=1） */
async function fetchAnalysis(manual) {
  const url = analysisUrl();
  if (!url || !state.sync.key) { analysisMsg = '还没设置云同步'; if (manual) render(); return; }
  if (!manual && Date.now() - lastAnalysisAt < 10 * 60 * 1000) return;
  lastAnalysisAt = Date.now();
  try {
    const r = await fetch(url + (manual ? '?refresh=1' : ''), { cache: 'no-store',
      headers: { 'Authorization': 'Bearer ' + state.sync.key } });
    if (r.status === 404) { analysisMsg = '云端还没有你的学习记录：随便做一题、背一个词就会自动上传'; render(); return; }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    analysis = await r.json();
    localStorage.setItem('tdxl_analysis', JSON.stringify(analysis));
    analysisMsg = manual ? '已按最新记录重算' : '';
    render();
  } catch (e) {
    analysisMsg = manual ? '云端暂时连不上：' + e.message + '（下面若是本机估算，仅供参考）' : '';
    if (manual) render();
  }
}
/** 学习成果分析卡：数据自动来、说明写在卡里 */
function analysisText() {
  const rep = weeklyReport();
  if (analysis && analysis.generatedAt) {
    return ['【学习成果分析】' + analysis.window.from + ' ~ ' + analysis.window.to,
      '学习天数：' + analysis.studiedDays + '/7 ｜ 完成率：' + (analysis.avgCompletion === null ? '—' : analysis.avgCompletion + '%') +
      ' ｜ 正确率：' + (analysis.avgAccuracy === null ? '—' : analysis.avgAccuracy + '%'),
      '分题型：' + (analysis.sections || []).map((s) => `${s.name} ${s.ratio}%（${s.total} 题）`).join('、'),
      '薄弱题型：' + (analysis.weak ? analysis.weak.name + ' ' + analysis.weak.ratio + '%' : '暂无明显薄弱'),
      '下周调整：' + (analysis.advice ? [analysis.advice.newWords, analysis.advice.planScale < 1 ? '任务量×0.7' : '任务量不变',
        analysis.advice.focus.join('、') || '无明显专项'].join(' ｜ ') : '—'),
      analysis.summary].join('\n');
  }
  return rep.text;
}
function analysisCard() {
  const rep = weeklyReport();
  const hasCloud = analysis && analysis.generatedAt;
  const a = hasCloud ? analysis : {
    avgCompletion: rep.avgCompletion, avgAccuracy: rep.avgAccuracy, studiedDays: rep.studiedDays,
    weak: rep.sections.filter((x) => x.total >= 3).sort((x, y) => x.ratio - y.ratio)[0] || null,
    advice: null, summary: rep.tips.join('；'), words: { known: rep.known, fuzzy: rep.fuzzy, unknown: rep.unknown },
  };
  const when = hasCloud ? String(analysis.generatedAt).replace('T', ' ').slice(0, 16) : '本机估算';
  const adv = a.advice;
  const advText = adv
    ? [adv.newWords === 'half' ? '新词减半' : adv.newWords === 'plus25' ? '新词加量 25%' : '词汇量保持',
       adv.planScale < 1 ? '任务量 ×0.7' : '任务量不变',
       adv.focus.length ? '加练 ' + adv.focus.join('、') : '无明显薄弱项'].join(' ｜ ')
    : '';
  return `<div class="card" id="analysisCard"><h3>学习成果分析</h3>
    <div class="dash">
      <div><b>${a.studiedDays === null ? '—' : a.studiedDays + '/7'}</b><span>学习天数</span></div>
      <div><b>${a.avgCompletion === null ? '—' : a.avgCompletion + '%'}</b><span>完成率</span></div>
      <div><b>${a.avgAccuracy === null ? '—' : a.avgAccuracy + '%'}</b><span>正确率</span></div>
      <div><b>${a.weak ? a.weak.name : '—'}</b><span>薄弱题型${a.weak ? ' ' + a.weak.ratio + '%' : ''}</span></div>
      <div><b>${a.words ? a.words.known : 0}</b><span>累计认识词</span></div>
      <div><b>${a.words ? a.words.unknown : 0}</b><span>待攻克的词</span></div>
    </div>
    <div class="muted" style="margin-top:8px">${CN(a.summary)}</div>
    ${advText ? `<div class="hint" style="margin-top:6px">下周调整：${advText}</div>` : ''}
    <div class="row" style="margin-top:10px"><button class="btn" id="btnAnalysisRefresh">立即刷新</button>
      <button class="btn ghost" id="btnAnalysisCopy">复制分析文本</button></div>
    <div class="muted" style="margin-top:6px;font-size:12px">
      这张卡不用你手动发我：你做过的题、背过的词会自动上传，云端按近 7 天算好分析（每天 21:00 自动重算，打开 App 也会刷新）。
      ${hasCloud ? '数据时间 ' + when : '（云端还没数据，下面是本机估算）'}<br>
      ${analysisMsg ? CN(analysisMsg) : '想立刻看最新结果，点「立即刷新」。'}
    </div></div>`;
}
function appliedVer() { return (state && state.contentVer) || (CONTENT && CONTENT.generated) || ''; }
function refreshTop() {
  const days = CONTENT.plan['日计划'] || [];
  $('#topSub').textContent = `距考试 ${daysToExam(CONTENT.plan['考试日期'])} 天（${CONTENT.plan['考试日期']}）｜ 计划 ${CONTENT.plan['起始']} 起 ${days.length} 天`;
}
function updateBar() {
  return `<div class="card" style="display:flex;align-items:center;gap:8px;justify-content:space-between;padding:8px 12px">
    <span class="muted" id="updMsg" style="font-size:12px">${updNote || '内容版本 ' + (CONTENT.generated || '未知')}</span>
    <button class="btn" id="btnUpdate" style="flex:0 0 auto">一键更新</button></div>`;
}
async function checkContent(manual) {
  if (!CONTENT) return;
  if (!manual && Date.now() - lastAutoCheck < 2 * 60 * 1000) return;   // 前台来回切换时：2 分钟最多一次
  lastAutoCheck = Date.now();
  let v = null;
  try {
    const r = await fetch('./data/version.json?ts=' + Date.now(), { cache: 'no-store' });
    if (r.ok) v = await r.json();
  } catch (e) { v = null; }
  state.lastCheck = Date.now(); saveStateRaw();
  if (!v || !v.generated) {
    if (manual) { updNote = '检查失败：没拿到版本信息（可能离线），稍后会自动再试'; render(); }
    return;
  }
  if (v.generated === appliedVer() || v.generated === (CONTENT && CONTENT.generated)) {
    state.contentVer = v.generated; saveStateRaw();
    updNote = '已是最新（' + v.generated + '）'; render(); return;
  }
  try {
    const r2 = await fetch('./data/content.json?ts=' + Date.now(), { cache: 'no-store' });
    if (!r2.ok) throw new Error('HTTP ' + r2.status);
    CONTENT = await r2.json();
    state.contentVer = v.generated;
    state.planOverride = null;                       // 后台的新计划优先，清掉旧的本地导入
    saveState(); refreshTop();
    const days = (CONTENT.plan['日计划'] || []).length;
    updNote = '已更新：' + (v.note ? v.note + ' ｜ ' : '') + CONTENT.plan['起始'] + ' 起 ' + days + ' 天';
    render();
  } catch (e) {
    updNote = '更新失败：' + e.message + '（本地版本照常用）'; render();
  }
}

async function boot() {
  state = loadState() || freshState();
  try {
    CONTENT = window.__CONTENT__ || await (await fetch('./data/content.json')).json();
  } catch (e) {
    view().innerHTML = '<div class="card">内容包加载失败：' + e + '</div>'; return;
  }
  if (state.planOverride && state.planOverride['日计划']) CONTENT.plan = state.planOverride;
  refreshTop();
  document.querySelectorAll('.tabs button').forEach((b) => b.onclick = () => switchTab(b.dataset.tab));
  render();
  setTimeout(() => checkContent(false), 1500);                     // 打开就自动检查一次
  setTimeout(() => fetchAnalysis(false), 3000);                    // 打开就拉一次云端分析（约 10 分钟最多一次）
  setTimeout(() => {                                               // 上次没传上去的，打开就补传
    if (state.sync && state.sync.pending) autoSync();
  }, 2500);
  document.addEventListener('visibilitychange', () => {            // 回到前台也检查一次
    if (document.visibilityState === 'visible') checkContent(false);
  });
}

function render() {
  if (tab === 'today') renderToday();
  else if (tab === 'practice') renderPractice();
  else if (tab === 'materials') renderMaterials();
  else renderMine();
}

/* ---------------- 今日 ---------------- */
function planDay() {
  const days = CONTENT.plan['日计划'] || [];
  return days.find((d) => d['日期'] === todayStr()) || days[0] || null;
}
function dayState(date) { state.days[date] = state.days[date] || { tasks: {} }; return state.days[date]; }

/* ---------------- 学习时长（心跳：页面可见时每分钟记 1 分钟） ---------------- */
function totalMinutes() {
  return Object.values(state.activity || {}).reduce((a, v) => a + (v.minutes || 0), 0);
}
setInterval(() => {
  if (document.visibilityState !== 'visible' || !CONTENT) return;
  const a = todayAct();
  a.minutes = (a.minutes || 0) + 1;
  saveState();
}, 60000);

/* ---------------- 仪表板（一屏六项） ---------------- */
function dashboardCard(day, rows, done) {
  const rep = weeklyReport();
  const last = (state.exams || []).slice(-1)[0];
  const weak = rep.sections.filter((s) => s.total >= 3).sort((a, b) => a.ratio - b.ratio)[0];
  const mins = totalMinutes();
  const today = (todayAct().minutes || 0);
  return `<div class="card"><h3>仪表板</h3>
    <div class="dash">
      <div><b>${done}/${rows.length}</b><span>今日任务</span></div>
      <div><b>${rep.avgCompletion === null ? '—' : rep.avgCompletion + '%'}</b><span>本周完成率</span></div>
      <div><b>${Math.floor(mins / 60)}h${mins % 60}m</b><span>累计学习（今日 ${today}m）</span></div>
      <div><b>${last ? last.score75 : '—'}</b><span>最近成绩 /75</span></div>
      <div><b>${weak ? weak.name : '—'}</b><span>薄弱题型${weak ? ' ' + weak.ratio + '%' : ''}</span></div>
      <div><button class="btn" id="btnDashExam">考试入口</button><span>每两周一次</span></div>
    </div>
    <div class="muted" style="margin-top:8px">今日：${day['日期']} · ${day['类型']} · ${day['阶段']} ｜ 距考试 ${daysToExam(CONTENT.plan['考试日期'])} 天</div></div>`;
}

function taskAction(t) {
  const ty = t['类型'] || '';
  if (ty === '新词' || ty === '复习词') return { label: '背词', go: () => openWords(t['词表'] || []) };
  if (ty === '语法/考点') return { label: '去读', go: () => goMaterialNext() };
  if (ty === '翻译/写作' || ty === '写作') return { label: '去写作', go: () => goWriting(t['年份']) };
  if (ty === '错题重做') return { label: '去错题', go: () => { subPractice = 'wrong'; switchTab('practice'); } };
  if (ty === '整卷模考') return { label: '开考', go: () => goPractice(t['年份'], t['题型'] === '整卷' ? '词汇题' : t['题型']) };
  if (['词汇题', '精读', '口语交际', '阅读理解', '完形填空', '短文完成'].includes(ty))
    return { label: '去做题', go: () => goPractice(t['年份'], t['题型'] || ty) };
  return null;
}
/** 直达练习：指定年份与题型并自动开始 */
function goPractice(year, section) {
  if (year) pYear = String(year);
  if (section && SECTIONS[section]) pSection = section;
  subPractice = 'exam';
  pQuestions = [];
  switchTab('practice');
  const [lo, hi] = SECTIONS[pSection] || [1, 10];
  pQuestions = (CONTENT.exams[pYear] || []).filter((q) => q.no >= lo && q.no <= hi);
  renderQuestions();
}
/** 直达写作：定位到某年的翻译/写作 */
function goWriting(year) {
  subPractice = 'writing';
  switchTab('practice');
  if (year) setTimeout(() => {
    const el = document.getElementById('w-' + year);
    if (el) { el.open = true; el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  }, 60);
}
/** 直达资料：优先打开第一节未读的语法，其次考点 */
function goMaterialNext() {
  const act = todayAct();
  const grammar = (CONTENT.materials || {}).grammar || [];
  const next = grammar.find((g) => !act.read['grammar:' + g.index]);
  subMaterials = next ? 'grammar' : 'tips';
  switchTab('materials');
  if (next) setTimeout(() => {
    const el = document.getElementById('g-' + next.index);
    if (el) { el.open = true; el.scrollIntoView({ behavior: 'smooth', block: 'start' }); act.read['grammar:' + next.index] = Date.now(); saveState(); }
  }, 60);
}
function setSectionFor(ty) {
  const map = { '词汇题': '词汇题', '精读': '阅读理解', '口语交际': '口语交际', '阅读理解': '阅读理解',
                '完形填空': '完形填空', '短文完成': '短文完成', '整卷模考': '词汇题' };
  pSection = map[ty] || '词汇题';
  pQuestions = [];
}
function renderToday() {
  const day = planDay();
  if (!day) { view().innerHTML = '<div class="card">计划为空。</div>'; return; }
  const ds = dayState(day['日期']);
  const rows = (day['时段'] || []).flatMap((s, si) => (s['任务清单'] || []).map((t, ti) => ({ s, t, si, ti })));
  const counted = rows.map((r) => taskProgress(r.t)).filter((p) => p.status !== 'none');
  const done = counted.filter((p) => p.status === 'ok').length;
  const pct = counted.length ? Math.round(done / counted.length * 100) : 0;
  const isToday = day['日期'] === todayStr();
  let html = updateBar() + dashboardCard(day, rows, done) + analysisCard() + `<div class="card"><h3>${day['日期']} 周${day['星期']} · ${day['类型']} · ${day['阶段']}</h3>
    <div class="bar"><i style="width:${pct}%"></i></div>
    <div class="muted">已完成 <b>${done}</b> / 未完成 <b>${counted.length - done}</b>（${pct}%）${isToday ? '' : '（当前显示 ' + day['日期'] + ' 的计划）'}<br>
      <span style="font-size:12px">完成状态由你的实际学习记录自动判定（背完词/做完题/读过资料即自动打勾）</span></div>
    <div class="row" style="margin-top:8px"><button class="btn ghost" id="btnPlanView">${planOpen ? '收起完整计划' : '查看完整计划'}</button>
    <span class="muted">${CONTENT.plan['起始']} 起 ${(CONTENT.plan['日计划'] || []).length} 天</span></div>
    ${planOpen ? planList() : ''}</div>` + firstRunCard();
  (day['时段'] || []).forEach((s, si) => {
    html += `<div class="card slot"><h3>${s['名称']} ${s['开始']} · ${s['分钟']} 分钟</h3>`;
    (s['任务清单'] || []).forEach((t, ti) => {
      const key = si + '-' + ti, act = taskAction(t), prog = taskProgress(t);
      const badge = prog.status === 'none'
        ? '<span class="stat todo">—</span>'
        : prog.status === 'ok'
          ? '<span class="stat ok">✓ 已完成</span>'
          : prog.status === 'doing'
            ? `<span class="stat doing">进行中 ${prog.done}/${prog.total}</span>`
            : '<span class="stat todo">未完成</span>';
      html += `<div class="task" style="${prog.status === 'ok' ? 'opacity:.7' : ''}">
        <div class="t"><span class="tag">${t['类型']}</span>${CN(t['范围'] || t['内容'])}
          <div class="muted">${t['预计分钟'] ? t['预计分钟'] + ' 分钟' : ''} ${badge}</div></div>
        ${act ? `<button class="btn" data-act="${key}">${prog.status === 'ok' ? '再看' : act.label}</button>` : ''}</div>`;
    });
    html += '</div>';
  });
  view().innerHTML = html;
  $('#btnPlanView').onclick = () => { planOpen = !planOpen; renderToday(); };
  const updBtn = document.getElementById('btnUpdate');
  if (updBtn) updBtn.onclick = () => {
    updNote = '正在检查…'; renderToday();
    checkContent(true);
  };
  const dashExam = document.getElementById('btnDashExam');
  if (dashExam) dashExam.onclick = () => { subPractice = 'testing'; switchTab('practice'); };
  const anRefresh = document.getElementById('btnAnalysisRefresh');
  if (anRefresh) anRefresh.onclick = () => { analysisMsg = '正在按最新记录重算…'; renderToday(); fetchAnalysis(true); };
  const anCopy = document.getElementById('btnAnalysisCopy');
  if (anCopy) anCopy.onclick = async () => {
    const text = analysisText();
    try { await navigator.clipboard.writeText(text); alert('已复制分析文本'); }
    catch (e) { window.prompt('复制下面这段：', text); }
  };
  const ob = document.getElementById('btnOnboard');
  if (ob) ob.onclick = () => { localStorage.setItem('tdxl_onboarded', '1'); renderToday(); };
  rows.forEach((r) => {
    const act = taskAction(r.t);
    if (!act) return;
    const btn = view().querySelector(`button[data-act="${r.si}-${r.ti}"]`);
    if (btn) btn.onclick = act.go;
  });
}
function planList() {
  const days = CONTENT.plan['日计划'] || [];
  const today = todayStr();
  return `<div style="margin-top:8px">` + days.map((d) => {
    const n = (d['时段'] || []).reduce((a, s) => a + ((s['任务清单'] || []).length), 0);
    const main = (d['时段'] || []).flatMap((s) => (s['任务清单'] || []).map((t) => t['类型']))
      .filter((v, i, arr) => arr.indexOf(v) === i).slice(0, 3).join('、');
    return `<div class="plan-row ${d['日期'] === today ? 'today' : ''}">
      <span class="plan-date">${d['日期'].slice(5)} 周${d['星期']}</span>
      <span class="tag">${d['阶段']}</span>
      <span class="muted">${d['类型']} ｜ ${n} 项 ｜ ${main || '休息'}</span></div>`;
  }).join('') + `</div>
  <div class="hint" style="margin-top:8px">想换计划：把新的 <b>计划-日期.json</b> 用「我的 → 数据 → 导入新计划」导进来即可。</div>`;
}
function firstRunCard() {
  if (localStorage.getItem('tdxl_onboarded')) return '';
  return `<div class="card" style="border-color:#f1e3b8;background:#fffdf5"><h3>第一次使用（3 步）</h3>
    <div>1. 下面就是今天的任务，按时间顺序做，做完打勾。</div>
    <div>2. 每个任务右边都有入口按钮：「背词」「去资料」「去做题」「去写作」。</div>
    <div>3. 装到手机主屏：用浏览器打开本页 → 菜单选「添加到主屏幕」（iPhone：分享 → 添加到主屏幕）。</div>
    <div class="row" style="margin-top:8px"><button class="btn" id="btnOnboard">知道了</button></div></div>`;
}

/* ---------------- 背词（全屏 · 三档 · 双模式） ---------------- */
const wf = { list: [], idx: 0, mode: 'en2cn', revealed: false, ok: 0, mid: 0, no: 0 };
function vocabMap() {
  const m = {};
  const src = (CONTENT.vocab.learn && CONTENT.vocab.learn.length) ? CONTENT.vocab.learn : (CONTENT.vocab.core || []);
  src.forEach((w) => { const k = String(w.word).toLowerCase(); if (!m[k]) m[k] = w; });
  return m;
}
function openWords(words) {
  const m = vocabMap();
  const list = (words || []).map((w) => m[String(w).toLowerCase()] || { word: w, meaning: '（词库暂未收录，可在真题解析里查）' });
  if (!list.length) { alert('这一项没有可背的单词（可能已复习完或词表为空）'); return; }
  wf.list = list; wf.idx = 0; wf.mode = localStorage.getItem(MODE_KEY) || 'en2cn';
  wf.revealed = false; wf.ok = wf.mid = wf.no = 0;
  showWord();
}
function showWord() {
  let el = document.getElementById('wordfull');
  if (!el) { el = document.createElement('div'); el.id = 'wordfull'; el.className = 'wordfull'; document.body.appendChild(el); }
  if (wf.idx < 0) wf.idx = 0;
  if (wf.idx >= wf.list.length) { closeWord(); return; }
  const w = wf.list[wf.idx];
  const front = wf.mode === 'en2cn'
    ? `<div class="wf-word">${CN(w.word)}</div><div class="wf-phon">${CN(w.phonetic)}</div>`
    : `<div class="wf-answer" style="font-size:26px">${CN(w.meaning)}</div>`;
  const back = wf.revealed
    ? (wf.mode === 'en2cn'
        ? `<div class="wf-answer">${CN(w.meaning)}</div>` + (w.examples && w.examples[0] ? `<div class="wf-ex">真题原句：${w.examples[0]}</div>` : '')
        : `<div class="wf-word" style="margin-top:18px">${CN(w.word)}</div><div class="wf-phon">${CN(w.phonetic)}</div>` +
          (w.examples && w.examples[0] ? `<div class="wf-ex">真题原句：${w.examples[0]}</div>` : ''))
    : '';
  el.innerHTML = `<div class="wf-top">
      <span>${wf.idx + 1} / ${wf.list.length} ｜ 认识 ${wf.ok} · 模糊 ${wf.mid} · 不认识 ${wf.no}</span>
      <span><button class="btn ghost" id="wfMode">${wf.mode === 'en2cn' ? '英→中' : '中→英'}</button>
      <button class="btn ghost" id="wfClose">关闭</button></span></div>
    <div class="wf-body">${front}${back}
      ${wf.mode === 'cn2en' && !wf.revealed ? `<input class="wf-input" id="wfInput" placeholder="先在心里/纸上写，再点显示答案">` : ''}
      ${!wf.revealed ? `<div style="margin-top:18px"><button class="btn" id="wfShow">显示答案</button></div>` : ''}</div>
    <div class="wf-bottom">
      <div class="wf-rate">
        <button class="wf-unknown" data-rate="unknown">不认识</button>
        <button class="wf-fuzzy" data-rate="fuzzy">模糊</button>
        <button class="wf-known" data-rate="known">认识</button></div>
      <div class="wf-nav">
        <button id="wfPrev" ${wf.idx === 0 ? 'disabled' : ''}>← 上一个</button>
        <button id="wfNext" ${wf.idx >= wf.list.length - 1 ? 'disabled' : ''}>下一个 →</button></div></div>`;
  el.classList.add('show');
  $('#wfClose').onclick = closeWord;
  $('#wfMode').onclick = () => { wf.mode = wf.mode === 'en2cn' ? 'cn2en' : 'en2cn'; localStorage.setItem(MODE_KEY, wf.mode); wf.revealed = false; showWord(); };
  const sh = $('#wfShow'); if (sh) sh.onclick = () => { wf.revealed = true; showWord(); };
  $('#wfPrev').onclick = () => { wf.idx--; wf.revealed = false; showWord(); };
  $('#wfNext').onclick = () => { wf.idx++; wf.revealed = false; showWord(); };
  el.querySelectorAll('button[data-rate]').forEach((b) => b.onclick = () => {
    const w0 = wf.list[wf.idx], k = String(w0.word).toLowerCase();
    state.words[k] = state.words[k] || { known: 0, fuzzy: 0, unknown: 0 };
    const kind = b.dataset.rate;
    state.words[k][kind === 'known' ? 'known' : kind === 'fuzzy' ? 'fuzzy' : 'unknown']++;
    todayAct().words[k] = kind;                     // 记录今天背过这个词（自动完成用）
    saveState();
    if (kind === 'known') wf.ok++; else if (kind === 'fuzzy') wf.mid++; else wf.no++;
    wf.idx++; wf.revealed = false; showWord();
  });
}
function closeWord() {
  const el = document.getElementById('wordfull');
  if (el) el.classList.remove('show');
  if (wf.ok + wf.mid + wf.no > 0) alert(`本组完成：认识 ${wf.ok} ｜ 模糊 ${wf.mid} ｜ 不认识 ${wf.no}`);
}

/* ---------------- 练习：真题 / 错题本 / 写作翻译 ---------------- */
function renderPractice() {
  const seg = `<div class="seg">
    <button data-sub="exam" class="${subPractice === 'exam' ? 'active' : ''}">真题</button>
    <button data-sub="wrong" class="${subPractice === 'wrong' ? 'active' : ''}">错题本</button>
    <button data-sub="writing" class="${subPractice === 'writing' ? 'active' : ''}">写作翻译</button>
    <button data-sub="testing" class="${subPractice === 'testing' ? 'active' : ''}">考试</button></div>`;
  view().innerHTML = seg + (subPractice === 'wrong' ? '' : '');
  const bindSeg = () => view().querySelectorAll('.seg button').forEach((b) => b.onclick = () => { subPractice = b.dataset.sub; renderPractice(); });
  bindSeg();
  if (subPractice === 'exam') renderExam();
  else if (subPractice === 'wrong') renderWrong();
  else if (subPractice === 'testing') renderExamHub();
  else renderWriting();
}

/* ---------------- 考试系统：阶段卷 / 真题整卷 / 错题卷 ---------------- */
function phaseCode() {
  const day = planDay();
  return (day && day['阶段']) || 'P0';
}
function pickSections(code) {
  if (code === 'P0' || code === 'P1') return [['词汇题', 10], ['阅读理解', 15]];              // 25 题 / 45 分钟
  if (code === 'P2') return [['口语交际', 10], ['词汇题', 10], ['阅读理解', 25]];              // 45 题 / 90 分钟
  return [['口语交际', 10], ['词汇题', 10], ['阅读理解', 25], ['完形填空', 10], ['短文完成', 20]];   // 75 题 / 150 分钟
}
function buildPaper(mode) {
  if (mode === 'random' || mode === 'variant' || mode === 'make') return buildCustom(mode);
  if (mode === 'wrong') {
    const list = wrongList().slice(0, 20)
      .map((x) => Object.assign({}, x.q, { yr: String(x.qid).split(':')[0] }));
    return { name: '错题卷（20 题）', limitMin: 40, qs: list };
  }
  const years = Object.keys(CONTENT.exams).sort();
  const year = mode === 'full' ? years[years.length - 1]
    : years[(new Date().getDate() + years.length) % years.length];
  const spec = mode === 'full' ? pickSections('P9') : pickSections(phaseCode());
  const qs = [];
  spec.forEach(([sec, n]) => {
    const [lo, hi] = SECTIONS[sec];
    const pool = (CONTENT.exams[year] || []).filter((q) => q.no >= lo && q.no <= hi);
    qs.push(...pool.slice(0, n));
  });
  return { name: `${year} 年 · ${mode === 'full' ? '整卷' : '阶段卷'}（${qs.length} 题）`,
           limitMin: mode === 'full' ? 150 : Math.max(30, qs.length * 2), qs: stampYear(qs, year), year };
}

/* ---------------- 出题系统：随机卷 / 错题变式卷 / 自定义卷 ---------------- */
function shufflePick(arr, n) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a.slice(0, n);
}
function sectionOfQ(q) {
  return Object.keys(SECTIONS).find((s) => q.no >= SECTIONS[s][0] && q.no <= SECTIONS[s][1]) || '其他';
}
function allBySection(sec) {
  const [lo, hi] = SECTIONS[sec] || [1, 999];
  const pool = [];
  Object.entries(CONTENT.exams).forEach(([y, list]) => list.forEach((q) => {
    if (q.no >= lo && q.no <= hi && Object.keys(q.options || {}).length) {
      pool.push(q.yr ? q : Object.assign({}, q, { yr: y }));
    }
  }));
  return pool;
}
/** 给题目打上来源年份（跨年组卷时题号会重复，必须靠「年份:题号」区分） */
function stampYear(list, year) {
  return list.map((q) => (q.yr ? q : Object.assign({}, q, { yr: year })));
}
function qidOf(q, fallbackYear) {
  return `${q.yr || fallbackYear || ''}:${q.no}`;
}
function buildCustom(mode) {
  if (mode === 'random') {
    const spec = pickSections(phaseCode());
    const qs = [];
    spec.forEach(([sec, n]) => qs.push(...shufflePick(allBySection(sec), n)));
    return { name: `随机卷（${qs.length} 题）`, limitMin: Math.max(30, qs.length * 2), qs };
  }
  if (mode === 'variant') {
    const wrongs = wrongList().map((x) => Object.assign({}, x.q, { yr: String(x.qid).split(':')[0] }));
    if (!wrongs.length) return { name: '错题变式卷', limitMin: 30, qs: [] };
    const bySec = {};
    wrongs.forEach((q) => { const s = sectionOfQ(q); bySec[s] = (bySec[s] || 0) + 1; });
    const qs = [];
    Object.entries(bySec).forEach(([sec, n]) => {
      const used = new Set(wrongs.filter((q) => sectionOfQ(q) === sec).map((q) => qidOf(q)));
      const pool = allBySection(sec).filter((q) => !used.has(qidOf(q)));
      qs.push(...shufflePick(pool, n));
    });
    return { name: `错题变式卷（${qs.length} 题）`, limitMin: Math.max(30, qs.length * 2), qs };
  }
  // make：自定义（年份 × 题型 × 数量）
  const y = (makeOpts && makeOpts.year) || 'all';
  const sec = (makeOpts && makeOpts.sec) || '混合';
  const n = (makeOpts && makeOpts.n) || 20;
  const list = y === 'all'
    ? Object.entries(CONTENT.exams).flatMap(([yy, arr]) => stampYear(arr, yy))
    : stampYear(CONTENT.exams[y] || [], y);
  let pool = list.filter((q) => Object.keys(q.options || {}).length);
  if (sec !== '混合') {
    const [lo, hi] = SECTIONS[sec] || [1, 999];
    pool = pool.filter((q) => q.no >= lo && q.no <= hi);
  }
  const qs = shufflePick(pool, Math.min(n, pool.length));
  return { name: `自选卷（${y === 'all' ? '跨年' : y} · ${sec} · ${qs.length} 题）`,
           limitMin: Math.max(20, qs.length * 2), qs };
}
function renderExamHub() {
  const hist = (state.exams || []).slice().reverse();
  const code = phaseCode();
  const spec = pickSections(code);
  const years = Object.keys(CONTENT.exams).sort();
  const wrongN = wrongList().length;
  view().insertAdjacentHTML('beforeend', `
    <div class="card"><h3>考试中心</h3>
      <div class="muted">按你当前阶段（${code}）自动组卷：${spec.map(([s, n]) => s + ' ' + n + ' 题').join('、')}。
      客观题自动判分（满分 75），翻译写作 25 分交卷后自评。</div>
      <div class="row" style="margin-top:10px">
        <button class="btn" id="btnStage">阶段卷</button>
        <button class="btn ghost" id="btnFull">真题整卷（75 题/150 分钟）</button>
        <button class="btn ghost" id="btnWrongExam">错题卷（20 题）</button></div></div>
    <div class="card"><h3>出题器 · 自己组卷</h3>
      <div class="muted">想练哪儿就出哪儿。选好之后「练习这套」＝边做边看答案；「考这套」＝计时闭卷、交卷判分。</div>
      <div class="row" style="margin-top:10px">
        <select id="mkYear"><option value="all">全部年份</option>${years.map((y) => `<option value="${y}">${y} 年</option>`).join('')}</select>
        <select id="mkSec"><option value="混合">混合题型</option>${Object.keys(SECTIONS).map((s) => `<option value="${s}">${s}</option>`).join('')}</select>
        <select id="mkN">${[10, 20, 30, 50].map((n) => `<option value="${n}">${n} 题</option>`).join('')}</select>
      </div>
      <div class="row" style="margin-top:10px">
        <button class="btn" id="btnMakePractice">练习这套</button>
        <button class="btn ghost" id="btnMakeExam">考这套</button>
      </div>
      <div class="muted" id="mkHint" style="margin-top:8px"></div></div>
    <div class="card"><h3>一键组卷</h3>
      <div class="row">
        <button class="btn ghost" id="btnRandom">随机卷</button>
        <button class="btn ghost" id="btnVariant">错题变式卷（${wrongN} 题可参考）</button></div>
      <div class="muted" style="margin-top:8px">随机卷＝按当前阶段题型比例，从 6 年真题里随机抽（每次都不一样）；
        错题变式卷＝按你错题的题型分布，再抽同类型的新题练手（避开刚做错的那些）。</div></div>
    <div class="card"><h3>历史成绩（${hist.length} 次）</h3>
      ${hist.length ? hist.map((e) => `<div class="plan-row"><span class="plan-date">${String(e.date).slice(5, 16)}</span>
        <span class="tag">${e.name}</span><span class="muted">总分 ${e.total} ｜ 客观题 ${e.score75}/75 ｜ 用时 ${e.minutes} 分</span></div>`).join('')
        : '<div class="muted">还没有考试记录 —— 建议每两周考一次阶段卷</div>'}</div>`);
  $('#btnStage').onclick = () => startExam('stage');
  $('#btnFull').onclick = () => startExam('full');
  $('#btnWrongExam').onclick = () => startExam('wrong');
  $('#btnRandom').onclick = () => startExam('random');
  $('#btnVariant').onclick = () => startExam('variant');
  const mkHint = () => {
    const y = $('#mkYear').value, s = $('#mkSec').value;
    const list = y === 'all' ? Object.values(CONTENT.exams).flat() : (CONTENT.exams[y] || []);
    const avail = list.filter((q) => Object.keys(q.options || {}).length &&
      (s === '混合' || (q.no >= SECTIONS[s][0] && q.no <= SECTIONS[s][1]))).length;
    $('#mkHint').textContent = `题库里符合条件的有 ${avail} 题；出卷时随机抽 ${Math.min(makeOpts.n, avail)} 题。`;
  };
  ['mkYear', 'mkSec', 'mkN'].forEach((id) => {
    $('#' + id).onchange = () => {
      makeOpts = { year: $('#mkYear').value, sec: $('#mkSec').value, n: parseInt($('#mkN').value, 10) };
      mkHint();
    };
  });
  $('#mkYear').value = makeOpts.year; $('#mkSec').value = makeOpts.sec; $('#mkN').value = makeOpts.n;
  mkHint();
  $('#btnMakePractice').onclick = () => {
    const paper = buildCustom('make');
    if (!paper.qs.length) { alert('这个组合没有题目，换个年份或题型试试'); return; }
    pYear = null; pQuestions = paper.qs; subPractice = 'exam';
    switchTab('practice');
    const box = document.getElementById('qbox');
    if (box) { box.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  };
  $('#btnMakeExam').onclick = () => startExam('make');
}
function startExam(mode) {
  const paper = buildPaper(mode);
  if (!paper.qs.length) { alert('没有可用的题目（错题本为空？）'); return; }
  exam = { name: paper.name, qs: paper.qs, picks: {}, startTs: Date.now(), limitMin: paper.limitMin, year: paper.year };
  renderExamPaper();
  exam.timerId = setInterval(updateExamClock, 1000);
}
function updateExamClock() {
  const el = document.getElementById('examClock');
  if (!el || !exam) return;
  const sec = Math.round((Date.now() - exam.startTs) / 1000);
  const left = exam.limitMin * 60 - sec;
  el.textContent = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}` +
    ` / 限时 ${exam.limitMin} 分${left < 0 ? '（已超时）' : ''}`;
}
function renderExamPaper() {
  const answered = Object.keys(exam.picks).length;
  view().innerHTML = `
    <div class="card" style="position:sticky;top:44px;z-index:4"><div class="row"><b>${exam.name}</b>
      <span class="muted" id="examClock">00:00</span>
      <span class="muted" id="examProg">已答 ${answered}/${exam.qs.length}</span>
      <button class="btn" id="btnSubmit">交卷</button>
      <button class="btn ghost" id="btnAbort">放弃</button></div></div>
    <div id="examBox">${exam.qs.map((q, i) => `<div class="card q"><div class="muted">第 ${i + 1} 题 ｜ ${CN(q.section)}${q.yr ? ' ｜ 真题 ' + q.yr + ' 年第 ' + q.no + ' 题' : ''}</div>
      <div>${q.stem}</div>
      ${Object.keys(q.options || {}).map((k) => `<button class="opt" data-eq="${i}" data-k="${k}">${k}. ${q.options[k]}</button>`).join('')}</div>`).join('')}</div>`;
  updateExamClock();
  view().querySelectorAll('.opt').forEach((b) => b.onclick = () => {
    const i = b.dataset.eq;
    exam.picks[i] = b.dataset.k;
    view().querySelectorAll(`.opt[data-eq="${i}"]`).forEach((x) => x.classList.remove('right'));
    b.classList.add('right');
    const prog = document.getElementById('examProg');
    if (prog) prog.textContent = `已答 ${Object.keys(exam.picks).length}/${exam.qs.length}`;
  });
  $('#btnSubmit').onclick = () => {
    if (!confirm(`确认交卷？已答 ${Object.keys(exam.picks).length}/${exam.qs.length} 题`)) return;
    finishExam();
  };
  $('#btnAbort').onclick = () => { if (confirm('放弃这次考试？不计成绩')) { clearInterval(exam.timerId); exam = null; renderPractice(); } };
}
function finishExam() {
  clearInterval(exam.timerId);
  const bySec = {}, wrongs = [];
  let rightCount = 0;
  exam.qs.forEach((q, i) => {
    const sec = sectionOfQ(q);
    bySec[sec] = bySec[sec] || { total: 0, right: 0 };
    bySec[sec].total++;
    const pick = exam.picks[i];
    const right = pick && String(q.answer || '').trim().toUpperCase().startsWith(pick);
    if (right) { bySec[sec].right++; rightCount++; }
    else wrongs.push(q);
    // 答题记录入库（键＝「年份:题号」，做错的自动进错题本）
    const qid = qidOf(q, exam.year);
    if (qid.split(':')[0]) {
      state.answers[qid] = Object.assign({}, state.answers[qid], { k: pick || '-', right: !!right, ts: Date.now(), src: 'exam' });
    }
  });
  const minutes = Math.round((Date.now() - exam.startTs) / 60000);
  const paperTotal = exam.qs.length;
  const score75 = Math.round(rightCount / paperTotal * 75);          // 折算成整卷 75 分制
  const record = { name: exam.name, date: new Date().toISOString().slice(0, 16).replace('T', ' '),
                   score: rightCount, paperTotal, score75, total: score75, minutes,
                   sections: bySec, wrong: wrongs.length };
  state.exams = state.exams || [];
  state.exams.push(record);
  saveState();
  view().innerHTML = `<div class="card"><h3>成绩单 · ${record.name}</h3>
      <div style="font-size:30px;font-weight:700">${record.score} <span class="muted" style="font-size:16px">/ ${paperTotal}（本卷客观题）</span></div>
      <div class="muted">正确率 ${Math.round(record.score / paperTotal * 100)}% ｜ 折算整卷：<b>${score75} / 75</b></div>
      <div class="muted">用时 ${minutes} 分钟 ｜ 错题 ${wrongs.length} 道已自动进错题本</div>
      <div style="margin-top:10px">${Object.entries(bySec).map(([s, v]) =>
        `${s}：${v.right}/${v.total}（${Math.round(v.right / v.total * 100)}%）`).join('<br>')}</div>
      <div class="hint" style="margin-top:10px">参考：客观题 45/75 ≈ 总分 60 分线（翻译写作 25 分另计，建议自评后记在周报里）。</div>
      <div class="row" style="margin-top:12px"><button class="btn" id="btnBackExam">返回考试中心</button>
      <button class="btn ghost" id="btnGoWrong">看错题本</button></div></div>`;
  $('#btnBackExam').onclick = () => { exam = null; renderPractice(); };
  $('#btnGoWrong').onclick = () => { exam = null; subPractice = 'wrong'; renderPractice(); };
}
function countOf(year, section) {
  const [lo, hi] = SECTIONS[section] || [1, 10];
  return (CONTENT.exams[year] || []).filter((q) => q.no >= lo && q.no <= hi).length;
}
function renderExam() {
  const years = Object.keys(CONTENT.exams).sort();
  pYear = pYear || years[years.length - 1];
  const box = document.createElement('div');
  box.innerHTML = `<div class="card"><h3>真题练习</h3>
    <div class="row"><select id="selYear">${years.map((y) => `<option ${y === pYear ? 'selected' : ''}>${y}</option>`).join('')}</select>
    <select id="selSec">${Object.keys(SECTIONS).map((s) => `<option ${s === pSection ? 'selected' : ''}>${s}</option>`).join('')}</select>
    <button class="btn" id="btnStart">开始</button></div>
    <div class="muted">${pYear} 年 · ${pSection} 共 ${countOf(pYear, pSection)} 题</div></div><div id="qbox"></div>`;
  view().appendChild(box);
  $('#selYear').onchange = (e) => { pYear = e.target.value; renderPractice(); };
  $('#selSec').onchange = (e) => { pSection = e.target.value; pQuestions = []; renderPractice(); };
  $('#btnStart').onclick = () => {
    const [lo, hi] = SECTIONS[pSection] || [1, 10];
    pQuestions = (CONTENT.exams[pYear] || []).filter((q) => q.no >= lo && q.no <= hi);
    renderQuestions();
  };
  if (pQuestions.length) renderQuestions();
}
function renderQuestions() {
  const box = $('#qbox'); if (!box) return;
  let lastPassage = null;
  box.innerHTML = pQuestions.map((q, i) => {
    let head = '';
    if (q.passage && q.passage !== lastPassage) {
      lastPassage = q.passage;
      head = `<details class="card passage"><summary>📖 文章原文（${q.passage.length} 字，点开）</summary><div class="ptext">${q.passage}</div></details>`;
    }
    const opts = Object.keys(q.options || {}).map((k) => `<button class="opt" data-q="${i}" data-k="${k}">${k}. ${q.options[k]}</button>`).join('');
    return head + `<div class="card q" id="q${i}"><div class="muted">第 ${i + 1} 题 ｜ ${CN(q.section)}${q.yr ? ' ｜ 真题 ' + q.yr + ' 年第 ' + q.no + ' 题' : ''}</div>
      <div>${q.stem}</div>${opts}
      <div class="muted" id="ans${i}" style="display:none">答案：${CN(q.answer)}</div>
      <div class="explain" id="exp${i}" style="display:none">${CN(q.explanation)}</div></div>`;
  }).join('');
  box.querySelectorAll('.opt').forEach((b) => b.onclick = () => {
    const i = +b.dataset.q, q = pQuestions[i];
    const ansEl = box.querySelector('#ans' + i), expEl = box.querySelector('#exp' + i);
    if (ansEl && ansEl.style.display !== 'none') return;
    const right = CN(q.answer).trim().toUpperCase().startsWith(b.dataset.k);
    b.classList.add(right ? 'right' : 'wrong');
    if (!right) { const g = box.querySelector(`.opt[data-q="${i}"][data-k="${CN(q.answer).trim()[0]}"]`); if (g) g.classList.add('right'); }
    if (ansEl) ansEl.style.display = 'block';
    if (expEl) expEl.style.display = 'block';
    const qid = qidOf(q, pYear);
    if (qid.split(':')[0]) state.answers[qid] = { k: b.dataset.k, right, ts: Date.now() };
    saveState();
  });
}
function findQuestion(qid) {
  const [year, no] = String(qid).split(':');
  return (CONTENT.exams[year] || []).find((q) => String(q.no) === String(no)) || null;
}
function wrongList() {
  return Object.entries(state.answers || {})
    .filter(([, r]) => r && r.right === false && !r.mastered)
    .map(([qid, r]) => ({ qid, rec: r, q: findQuestion(qid) })).filter((x) => x.q);
}
function renderWrong() {
  const items = wrongList();
  const card = document.createElement('div');
  if (!items.length) {
    card.innerHTML = `<div class="card"><h3>错题本</h3><div class="muted">还没有错题。做错的题会自动进这里（对应计划里「错题重做」）。</div></div>`;
    view().appendChild(card); return;
  }
  card.innerHTML = `<div class="card"><h3>错题本（${items.length} 题）</h3><div class="muted">重做答对一次即自动移出。</div></div>`;
  view().appendChild(card);
  items.forEach(({ qid, rec, q }) => {
    const opts = Object.keys(q.options || {}).map((k) => `<button class="opt" data-wq="${qid}" data-k="${k}">${k}. ${q.options[k]}</button>`).join('');
    const d = document.createElement('div');
    d.innerHTML = `<div class="card q"><div class="muted">${qid} ｜ 上次选了 ${CN(rec.k)}（错）</div><div>${q.stem}</div>${opts}
      <div class="explain">${CN(q.explanation)}</div>
      <div class="row"><button class="btn ghost" data-master="${qid}">已掌握，移出</button></div></div>`;
    view().appendChild(d);
  });
  view().querySelectorAll('button[data-wq]').forEach((b) => b.onclick = () => {
    const qid = b.dataset.wq, q = findQuestion(qid);
    const right = CN(q.answer).trim().toUpperCase().startsWith(b.dataset.k);
    b.classList.add(right ? 'right' : 'wrong');
    if (right) { state.answers[qid] = Object.assign({}, state.answers[qid], { right: true, retried: Date.now() }); saveState(); setTimeout(renderPractice, 700); }
  });
  view().querySelectorAll('button[data-master]').forEach((b) => b.onclick = () => {
    state.answers[b.dataset.master] = Object.assign({}, state.answers[b.dataset.master], { mastered: true });
    saveState(); renderPractice();
  });
}
function renderWriting() {
  const rows = CONTENT.writing || [];
  const card = document.createElement('div');
  if (!rows.length) { card.innerHTML = '<div class="card">写作素材未打包。</div>'; view().appendChild(card); return; }
  const tr = rows.filter((r) => r.type === '翻译'), wr = rows.filter((r) => r.type === '写作');
  const item = (r, kind) => `<div class="card q" id="w-${r.year}-${r.type}"><div class="muted">${r.year} 年 ｜ ${r.type}${r.topic ? ' ｜ ' + r.topic : ''}</div>
    <details class="passage"><summary>📖 题目原文</summary><div class="ptext pre">${CN(r.source)}</div></details>
    <details class="passage" ${kind === 'writing' ? 'open' : ''}><summary>✅ ${kind === 'writing' ? '参考范文' : '参考译文'}</summary><div class="ptext pre">${CN(r.reference)}</div></details>
    ${r.notes ? `<details><summary>💡 ${kind === 'writing' ? '审题/结构提示' : '翻译要点'}</summary><div class="ptext pre">${CN(r.notes)}</div></details>` : ''}</div>`;
  card.innerHTML = `<div class="card"><h3>翻译＋写作（卷面 25 分）</h3><div class="muted">先自己写，再点开对照。建议每周各练 1 篇。</div></div>
    <div class="card"><h3>英译汉（${tr.length} 篇）</h3></div>${tr.map((r) => item(r, 'translation')).join('')}
    <div class="card"><h3>写作（${wr.length} 篇）</h3></div>${wr.map((r) => item(r, 'writing')).join('')}`;
  view().appendChild(card);
  // 展开范文即记为"今天已练"（自动完成翻译/写作任务）
  view().querySelectorAll('div[id^="w-"] details').forEach((d) => {
    d.ontoggle = () => {
      if (!d.open) return;
      const host = d.closest('div[id^="w-"]');
      if (host) { todayAct().writing[host.id.slice(2)] = Date.now(); saveState(); }
    };
  });
}

/* ---------------- 资料：语法 / 考点 ---------------- */
function renderMaterials() {
  const m = CONTENT.materials || {}, grammar = m.grammar || [], tips = m.tips || [];
  const seg = `<div class="seg">
    <button data-sub="grammar" class="${subMaterials === 'grammar' ? 'active' : ''}">语法（${grammar.length}）</button>
    <button data-sub="tips" class="${subMaterials === 'tips' ? 'active' : ''}">考点速记（${tips.length}）</button></div>`;
  view().innerHTML = seg;
  view().querySelectorAll('.seg button').forEach((b) => b.onclick = () => { subMaterials = b.dataset.sub; renderMaterials(); });
  const box = document.createElement('div');
  if (subMaterials === 'grammar') {
    box.innerHTML = `<div class="card"><h3>语法（${grammar.length} 节）</h3><div class="muted">对应计划 11:30 时段"语法 1 节"。</div></div>` +
      grammar.map((g) => `<details class="card passage" id="g-${g.index}"><summary>📘 第${g.no}节 ${g.title}</summary><div class="ptext pre">${CN(g.body)}</div></details>`).join('');
  } else {
    const chapters = [...new Set(tips.map((t) => t.chapter))];
    box.innerHTML = `<div class="card"><h3>考点速记（${tips.length} 节）</h3><div class="muted">对应计划 11:30 时段"考点速记 1 个场景"。</div></div>` +
      chapters.map((ch) => `<div class="card"><h3>${ch}</h3></div>` +
        tips.filter((t) => t.chapter === ch).map((t) => `<details class="card passage" id="t-${t.index}"><summary>🔖 ${t.title}</summary><div class="ptext pre">${CN(t.body)}</div></details>`).join('')).join('');
  }
  view().appendChild(box);
  // 打开即记为"今天读过"（自动完成 11:30 时段任务）
  view().querySelectorAll('details').forEach((d) => {
    d.ontoggle = () => {
      if (d.open && /^[gt]-\d+$/.test(d.id)) {
        todayAct().read[d.id] = Date.now();
        saveState();
      }
    };
  });
}

/* ---------------- 我的：周报 / 更新 / 同步 / 数据 ---------------- */
function lastNDates(n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); out.push(d.toLocaleDateString('sv-SE')); }
  return out;
}
function weeklyReport() {
  const dates = lastNDates(7);
  const rows = dates.map((d) => state.days[d]).filter(Boolean);
  const studiedDays = rows.filter((r) => Object.values(r.tasks || {}).some(Boolean)).length;
  const rates = rows.map((r) => { const t = Object.keys(r.tasks || {}).length; return t ? Math.round(Object.values(r.tasks).filter(Boolean).length / t * 100) : null; }).filter((x) => x !== null);
  const avgCompletion = rates.length ? Math.round(rates.reduce((a, b) => a + b, 0) / rates.length) : null;
  const since = Date.now() - 7 * 864e5;
  const week = Object.entries(state.answers || {}).filter(([, r]) => (r.ts || 0) >= since);
  const bySec = {};
  week.forEach(([qid, r]) => {
    const no = parseInt(String(qid).split(':')[1] || '0', 10);
    const hit = Object.entries(SECTIONS).find(([, rg]) => no >= rg[0] && no <= rg[1]);
    const key = hit ? hit[0] : '其他';
    bySec[key] = bySec[key] || { total: 0, right: 0 };
    bySec[key].total++; if (r.right) bySec[key].right++;
  });
  const sections = Object.entries(bySec).map(([name, v]) => ({ name, total: v.total, ratio: Math.round(v.right / v.total * 100) })).sort((a, b) => b.total - a.total);
  const avgAccuracy = week.length ? Math.round(week.filter(([, r]) => r.right).length / week.length * 100) : null;
  const known = Object.values(state.words || {}).reduce((a, v) => a + (v.known || 0), 0);
  const fuzzy = Object.values(state.words || {}).reduce((a, v) => a + (v.fuzzy || 0), 0);
  const unknown = Object.values(state.words || {}).reduce((a, v) => a + (v.unknown || 0), 0);
  const tips = [];
  if (avgAccuracy !== null && avgAccuracy < 60) tips.push('正确率偏低：下周新词减半、复习加倍');
  else if (avgAccuracy !== null && avgAccuracy > 85) tips.push('正确率很好：下周可加量 25%');
  if (avgCompletion !== null && avgCompletion < 70) tips.push('完成率不足 70%：先保住晨读 30 分钟不断线，其余按 0.7 缩减');
  sections.filter((s) => s.total >= 3 && s.ratio < 70).forEach((s) => tips.push(`${s.name} 正确率 ${s.ratio}%：下周每天加 1 次该题型专项`));
  if (!tips.length) tips.push('各项指标正常，保持节奏；周末可安排整套限时模考');
  const text = ['【本周学习报告】' + dates[0] + ' ~ ' + dates[6],
    `有学习记录：${studiedDays}/7 天`, `平均完成率：${avgCompletion === null ? '—' : avgCompletion + '%'}`,
    `平均正确率：${avgAccuracy === null ? '—' : avgAccuracy + '%'}`,
    sections.length ? '分题型：' + sections.map((s) => `${s.name} ${s.ratio}%（${s.total} 题）`).join('、') : '分题型：本周无做题记录',
    `词汇：认识 ${known} ／ 模糊 ${fuzzy} ／ 不认识 ${unknown}`,
    '建议：' + tips.join('；')].join('\n');
  return { studiedDays, avgCompletion, avgAccuracy, sections, known, fuzzy, unknown, tips, text };
}
/* ---------------- 学习记录中心 ---------------- */
function recordsRows(days) {
  return days.map((d) => {
    const a = (state.activity || {})[d] || {};
    const plan = (CONTENT.plan['日计划'] || []).find((x) => x['日期'] === d);
    const tasks = plan ? (plan['时段'] || []).flatMap((s) => s['任务清单'] || []) : [];
    const counted = tasks.map((t) => taskProgressAt(d, t)).filter((p) => p.status !== 'none');
    const done = counted.filter((p) => p.status === 'ok').length;
    const ans = answersOn(d);
    const right = ans.filter(([, r]) => r.right).length;
    return { d, minutes: a.minutes || 0, done, total: counted.length,
             words: Object.keys(a.words || {}).length, answers: ans.length, right };
  });
}
function recordsCard() {
  const days = lastNDates(14).reverse();
  const rows = recordsRows(days);
  const sum = rows.reduce((a, r) => ({ minutes: a.minutes + r.minutes, words: a.words + r.words,
                                       answers: a.answers + r.answers, right: a.right + r.right }),
                          { minutes: 0, words: 0, answers: 0, right: 0 });
  const known = Object.values(state.words || {}).reduce((a, v) => a + (v.known || 0), 0);
  const fuzzy = Object.values(state.words || {}).reduce((a, v) => a + (v.fuzzy || 0), 0);
  const unknown = Object.values(state.words || {}).reduce((a, v) => a + (v.unknown || 0), 0);
  const learned = Object.keys(state.words || {}).length;
  return `<div class="card"><h3>学习记录</h3>
    <div class="muted">近 14 天：学习 <b>${Math.floor(sum.minutes / 60)} 小时 ${sum.minutes % 60} 分</b> ｜ 背词 ${sum.words} 词次
      ｜ 答题 ${sum.answers} 题（正确率 ${sum.answers ? Math.round(sum.right / sum.answers * 100) : 0}%）</div>
    <div class="muted">词汇掌握：已学 <b>${learned}</b> 词 ｜ 认识 ${known} / 模糊 ${fuzzy} / 不认识 ${unknown}</div>
    <div class="row" style="margin-top:8px">
      <button class="btn ghost" id="btnRecords">${recordsOpen ? '收起每日明细' : '查看每日明细'}</button>
      <button class="btn ghost" id="btnExportCsv">导出 CSV</button></div>
    ${recordsOpen ? `<div style="margin-top:8px;overflow-x:auto"><table style="width:100%;font-size:13px;border-collapse:collapse">
      <tr><th align="left">日期</th><th>时长</th><th>任务</th><th>背词</th><th>答题</th><th>正确率</th></tr>
      ${rows.map((r) => `<tr><td>${r.d.slice(5)}</td><td align="center">${r.minutes}m</td>
        <td align="center">${r.done}/${r.total}</td><td align="center">${r.words}</td>
        <td align="center">${r.answers}</td><td align="center">${r.answers ? Math.round(r.right / r.answers * 100) + '%' : '—'}</td></tr>`).join('')}
    </table></div>` : ''}</div>`;
}
function exportCsv() {
  const days = lastNDates(30).reverse();
  const lines = ['日期,学习分钟,任务完成,任务总数,背词数,答题数,正确数,正确率'];
  recordsRows(days).forEach((r) => lines.push([r.d, r.minutes, r.done, r.total, r.words, r.answers, r.right,
    r.answers ? Math.round(r.right / r.answers * 100) + '%' : ''].join(',')));
  const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '英语学习记录-' + todayStr() + '.csv';
  a.click();
}

function renderMine() {
  fixSyncUrl();
  const rep = weeklyReport();
  view().innerHTML = `
    ${recordsCard()}
    <div class="card"><h3>最近成绩</h3>
      ${(state.exams && state.exams.length)
        ? (() => { const e = state.exams[state.exams.length - 1];
            return `<div>${e.name} ｜ <b>${e.score75}/75</b>（客观题） ｜ 用时 ${e.minutes} 分</div>
              <div class="muted">考试日期：${e.date} ｜ 共考过 ${state.exams.length} 次</div>`; })()
        : '<div class="muted">还没考过 —— 建议每两周做一次阶段卷（在「练习 → 考试」里）</div>'}
      <div class="row" style="margin-top:10px"><button class="btn" id="btnExamEntry">进入考试中心</button></div></div>
    <div class="card"><h3>本周报告</h3>
      <div>有学习记录 <b>${rep.studiedDays}/7</b> 天 ｜ 完成率 <b>${rep.avgCompletion === null ? '—' : rep.avgCompletion + '%'}</b> ｜ 正确率 <b>${rep.avgAccuracy === null ? '—' : rep.avgAccuracy + '%'}</b></div>
      ${rep.sections.length ? `<div class="muted" style="margin-top:6px">分题型：${rep.sections.map((s) => `${s.name} ${s.ratio}%`).join(' ｜ ')}</div>` : '<div class="muted" style="margin-top:6px">本周还没有做题记录</div>'}
      <div class="muted" style="margin-top:6px">词汇：认识 ${rep.known} ／ 模糊 ${rep.fuzzy} ／ 不认识 ${rep.unknown}</div>
      <div style="margin-top:8px">${rep.tips.map((t) => `· ${t}`).join('<br>')}</div>
      <div class="muted" style="margin-top:10px">这一份是本机兜底统计；正式的「学习成果分析」在<b>今日页</b>——自动更新，不用你发我。</div></div>

    <div class="card"><h3>计划与内容如何更新</h3>
      <div class="muted">当前计划：<b>${CONTENT.plan['起始']}</b> 起 <b>${(CONTENT.plan['日计划'] || []).length}</b> 天${state.planOverride ? '（已导入）' : '（内置）'}</div>
      <div style="margin-top:6px">· <b>换计划 / 换内容</b>：我在后台改完，你在<b>今日页顶部点「一键更新」</b>即可；平时打开 App 也会自动检查，通常你什么都不用做。</div>
      <div>· <b>每周节奏</b>：电脑端每周日 21:30 自动拉你的学习记录 → 按完成率/正确率重排下周计划 → 自动发版；你下次打开就是新计划，全程不用你动手。</div></div>

    <div class="card"><h3>时间提醒（导入手机日历）</h3>
      <div class="muted">点下面按钮下载日历文件，手机上打开就会问"要不要加入日历" —— 加进去之后，每天 <b>04:00 晨读 30 分钟</b>、<b>11:30 午间 30 分钟</b>、<b>17:00 晚间 2 小时</b> 自动响铃（提前 5 分钟提醒），<b>周日</b>只提醒你休息复盘，考前（2027-05-23）自动结束。</div>
      <div class="row" style="margin-top:10px"><a class="btn" href="./英语学习提醒.ics" download>下载日历提醒（.ics）</a></div>
      <div class="muted" style="margin-top:6px;font-size:12px">不依赖电脑、不依赖网络；想改时间或加节假日例外，跟我说一句我重新生成。</div></div>

    <div class="card"><h3>云同步（可选）</h3>
      <div class="muted">填地址和同步码后自动同步（不用也能本地学习）。地址已按当前站点自动填好，一般只需要填同步码。</div>
      <div class="row" style="margin-top:6px"><input id="syncUrl" placeholder="https://.../api/sync" style="flex:1;min-width:170px" value="${(state.sync && state.sync.url) || defaultSyncUrl()}">
      <input id="syncKey" type="password" placeholder="同步码" style="width:110px" value="${(state.sync && state.sync.key) || ''}"></div>
      <div class="muted" style="margin-top:6px">${channelNote()}</div>
      <div class="row" style="margin-top:6px"><label class="muted"><input type="checkbox" id="syncAuto" ${state.sync && state.sync.auto === false ? '' : 'checked'} style="vertical-align:-2px"> 改动自动上传（推荐）</label></div>
      <div class="row" style="margin-top:8px"><button class="btn ghost" id="btnDown">用云端数据覆盖本机</button>
      <span class="muted" id="syncMsg">${syncStatusText()}</span></div></div>

    <div class="card"><h3>数据</h3>
      <div class="row"><button class="btn" id="btnExport">导出数据</button><button class="btn ghost" id="btnImport">导入数据</button>
      <input type="file" id="fileIn" style="display:none" accept="application/json"></div>
      <div class="muted" style="margin-top:6px">数据只存在这台设备；换手机/清缓存前先导出。</div></div>

    <div class="card"><h3>关于</h3><div class="muted">离线可用｜内容来自你自己的 32 份资料｜考试日期 ${CONTENT.plan['考试日期']}（官方公布前为占位）</div></div>`;

  const saveSync = () => {
    const old = state.sync || {};
    state.sync = Object.assign({}, old, {
      url: $('#syncUrl').value.trim(), key: $('#syncKey').value.trim(),
      auto: $('#syncAuto').checked });
    saveState();
  };
  $('#syncAuto').onchange = () => { saveSync(); if ($('#syncAuto').checked) autoSync(); renderMine(); };
  $('#btnDown').onclick = async () => {
    saveSync(); if (!state.sync.url || !state.sync.key) return alert('先填地址和同步码');
    if (!confirm(state.sync.conflict ? '云端是别的设备改过的版本，用它覆盖本机？' : '用云端数据覆盖本机数据？')) return;
    try {
      const r = await fetch(state.sync.url, { cache: 'no-store', headers: { 'Authorization': 'Bearer ' + state.sync.key } });
      if (r.status === 404) return alert('云端还没有数据');
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json(), sync = state.sync;
      state = j.state;
      state.sync = Object.assign({}, sync, { lastSync: j.updatedAt || new Date().toLocaleString(),
                                             pending: false, conflict: false });
      saveStateRaw(); alert('已从云恢复'); renderMine();
    } catch (e) { alert('恢复失败：' + e.message); }
  };
  $('#btnExport').onclick = () => {
    const blob = new Blob([JSON.stringify(state, null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = '英语学习数据-' + todayStr() + '.json'; a.click();
  };
  $('#btnImport').onclick = () => $('#fileIn').click();
  $('#fileIn').onchange = (e) => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => { try { state = JSON.parse(r.result); saveState(); alert('导入完成'); renderMine(); } catch (err) { alert('导入失败：' + err); } };
    r.readAsText(f);
  };
  const rb = document.getElementById('btnRecords');
  if (rb) rb.onclick = () => { recordsOpen = !recordsOpen; renderMine(); };
  const ej = document.getElementById('btnExportCsv');
  if (ej) ej.onclick = exportCsv;
  const examBtn = document.getElementById('btnExamEntry');
  if (examBtn) examBtn.onclick = () => { subPractice = 'testing'; switchTab('practice'); };
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
boot();
