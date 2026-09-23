/* ============================================================
   小微行业知识库看板 V3 · 静态版（GitHub Pages）
   纯前端实现，数据来自 data.js 中的 SEED 变量
   ============================================================ */
'use strict';

// ------------------------------------------------------------------ 状态
const S = {
  token: localStorage.getItem('xwk_token') || 'static',
  user: null,
  page: 'dashboard',
  meta: null,
  dash: { industry: '', job: '', city: '', ci: new Set(), cj: new Set(), cc: new Set() },
  dashData: null,
  cache: {},
};

const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const nl2br = (v) => esc(v).replace(/\n/g, '<br>');

// ------------------------------------------------------------------ 本地 API 模拟
async function api(path, opt) {
  opt = opt || {};
  await new Promise(r => setTimeout(r, 10));

  if (path === '/api/login' && opt.method === 'POST') {
    const { username, password } = opt.body;
    if (password === 'bxyhxsb' || (username === 'admin' && password === 'bxyhxsb')) {
      return {
        token: 'static-token',
        user: { username: username || 'admin', display_name: '管理员', role: 'super_admin', can_view: true, can_edit: false, can_manage: true, must_change: false }
      };
    }
    throw new Error('密码错误，请输入正确的访问密码');
  }

  if (path === '/api/logout') return { ok: true };
  if (path === '/api/me') return { user: S.user };
  if (path === '/api/change-password') return { ok: true };
  if (path === '/api/meta') return { meta: buildMeta() };

  if (path.startsWith('/api/dashboard')) {
    const params = new URLSearchParams(path.split('?')[1] || '');
    return { data: buildDashboard(params) };
  }

  if (path.startsWith('/api/analytics')) {
    return { data: buildAnalytics() };
  }

  if (path.startsWith('/api/search')) {
    const q = decodeURIComponent(path.split('q=')[1] || '');
    return { results: buildSearch(q) };
  }

  if (path.startsWith('/api/collection/')) {
    const parts = path.replace('/api/collection/', '').split('?');
    const name = parts[0].split('/')[0];
    const params = new URLSearchParams(parts[1] || '');
    if (opt.method === 'PUT' || opt.method === 'POST' || opt.method === 'DELETE') {
      return { ok: true, updated: 1 };
    }
    return buildCollection(name, params);
  }

  if (path.startsWith('/api/export/')) {
    return { ok: true };
  }

  if (path.startsWith('/api/admin/')) {
    return { users: [], rows: [], sessions: [], total: 0, settings: { site_title: '小微行业知识库', notice: '', data_version: 'V3', session_hours: '12' }, selfcheck: { '通过': true }, persist: { mode: '静态部署（GitHub Pages）', repo: '—', branch: '—', interval_sec: 0, log_cap: 0, account_data_persisted: false, push_count: 0, last_push_at: null, last_push_ok: false, last_push_msg: '静态模式不支持持久化' } };
  }

  if (path.startsWith('/api/import/')) {
    return { added: 0, updated: 0, skipped: 0 };
  }

  return {};
}

// ------------------------------------------------------------------ 元数据
function buildMeta() {
  const m = SEED.meta;
  return {
    industry_count: SEED.industries.length,
    job_count: SEED.jobs.length,
    mode_count: SEED.modes.length,
    city_count: SEED.cities.length,
    city_risk_count: SEED.city_risks.length,
    source: m.source || '小微行业知识库看板V3.xlsx',
    categories: buildCategories(),
    cities: SEED.cities,
    supplemented_19: m.supplemented_19 || [],
  };
}

function buildCategories() {
  const cats = {};
  for (const ind of SEED.industries) {
    const cat = ind['行业门类'];
    if (!cats[cat]) cats[cat] = { 行业数: 0, 编号: [] };
    cats[cat].行业数++;
    cats[cat].编号.push(ind['行业编号']);
  }
  return cats;
}

// ------------------------------------------------------------------ 看板数据
function buildDashboard(params) {
  const indQ = (params.get('industry') || '').trim();
  const jobQ = (params.get('job') || '').trim();
  const cityQ = (params.get('city') || '').trim();
  const ci = params.get('ci') ? params.get('ci').split('|') : [];

  let resolvedCode = '';
  let industry = null;
  let candidates = [];

  if (indQ) {
    const lower = indQ.toLowerCase();
    const matches = SEED.industries.filter(ind => {
      return ind['行业编号'].toLowerCase().includes(lower) ||
             ind['细分行业'].toLowerCase().includes(lower) ||
             ind['行业门类'].toLowerCase().includes(lower) ||
             (ind['职业标签串'] || '').toLowerCase().includes(lower);
    });
    if (ci.length) {
      const exact = matches.find(m => m['行业编号'] === ci[0]);
      if (exact) { industry = exact; resolvedCode = exact['行业编号']; }
      candidates = matches.slice(0, 6).map(m => m['行业编号'] + '-' + m['细分行业']);
    } else if (matches.length === 1) {
      industry = matches[0];
      resolvedCode = industry['行业编号'];
      candidates = [industry['行业编号'] + '-' + industry['细分行业']];
    } else if (matches.length > 1) {
      candidates = matches.slice(0, 6).map(m => m['行业编号'] + '-' + m['细分行业']);
    }
  }

  const modes = industry ? SEED.modes.filter(m => m['行业编号'] === resolvedCode) : [];

  const allJobs = industry ? SEED.jobs.filter(j => j['行业编号'] === resolvedCode) : [];
  const hitJobs = allJobs.filter(j => !jobQ || (j['常见职位'] || '').includes(jobQ));
  const shownJobs = hitJobs.slice(0, 10);

  const allCities = SEED.cities;
  const cityMatches = cityQ ? allCities.filter(c => (c['城市名称'] || '').includes(cityQ) || (c['定位标签'] || '').includes(cityQ)) : allCities;
  const cityNames = cityMatches.map(c => c['城市名称']);

  const cityRisks = resolvedCode
    ? SEED.city_risks.filter(r => r['行业编号'] === resolvedCode && cityNames.includes(r['城市']))
    : [];

  return {
    status: {
      industry: industry ? industry['细分行业'] : (indQ ? `未找到匹配「${indQ}」的行业` : '全部行业'),
      job: jobQ ? `搜索：${jobQ}` : '全部职位',
      city: cityQ ? `筛选：${cityQ}` : '全部城市',
    },
    industry,
    resolvedCode,
    industryLabel: industry ? industry['细分行业'] : '',
    candidates,
    candidateTotal: candidates.length,
    modes,
    jobs: {
      all: allJobs.map(j => ({ ...j, '命中': hitJobs.includes(j), '三段式标签': j['常见职位'] })),
      hit: hitJobs.length,
      shown: shownJobs,
      shownCount: shownJobs.length,
      total: allJobs.length,
    },
    cities: {
      all: cityMatches.map(c => ({ ...c, '命中': cityQ ? cityMatches.includes(c) : true })),
      hit: cityMatches.length,
      shown: cityRisks,
      shownCount: cityRisks.length,
    },
  };
}

// ------------------------------------------------------------------ 统计分析
function buildAnalytics() {
  const industries = SEED.industries;
  const jobs = SEED.jobs;
  const modes = SEED.modes;
  const cities = SEED.cities;
  const cityRisks = SEED.city_risks;

  const categories = {};
  for (const ind of industries) {
    const cat = ind['行业门类'];
    if (!categories[cat]) categories[cat] = { 行业数: 0, 编号: [] };
    categories[cat].行业数++;
    categories[cat].编号.push(ind['行业编号']);
  }

  const riskByLevel = {};
  for (const r of cityRisks) {
    const lv = r['风险层级'] || '未分级';
    riskByLevel[lv] = (riskByLevel[lv] || 0) + 1;
  }

  const riskByCity = {};
  for (const c of cities) {
    const cn = c['城市名称'];
    riskByCity[cn] = {};
    for (const r of cityRisks) {
      if (r['城市'] === cn) {
        const lv = r['风险层级'] || '未分级';
        riskByCity[cn][lv] = (riskByCity[cn][lv] || 0) + 1;
      }
    }
  }

  const levelScore = (lv) => {
    if (!lv) return null;
    if (lv.startsWith('A')) return 1;
    if (lv.startsWith('B-C')) return 2.5;
    if (lv.startsWith('B')) return 2;
    if (lv.startsWith('C-D')) return 4.5;
    if (lv.startsWith('C')) return 3;
    if (lv.startsWith('D')) return 5;
    if (lv.startsWith('E')) return 6;
    return null;
  };

  const industryRisk = industries.map(ind => {
    const risks = cityRisks.filter(r => r['行业编号'] === ind['行业编号']);
    const scores = risks.map(r => levelScore(r['风险层级'])).filter(s => s != null);
    const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
    const highCity = risks.reduce((max, r) => {
      const s = levelScore(r['风险层级']);
      return s != null && (max.score == null || s > max.score) ? { city: r['城市'], score: s } : max;
    }, { city: '', score: null });
    return {
      '行业编号': ind['行业编号'],
      '细分行业': ind['细分行业'],
      '风险指数': avg ? Math.round(avg * 100) / 100 : null,
      '最高风险城市': highCity.city,
    };
  }).sort((a, b) => (b.风险指数 || 0) - (a.风险指数 || 0));

  const coverage = industries.map(ind => {
    const jobCount = jobs.filter(j => j['行业编号'] === ind['行业编号']).length;
    const modeCount = modes.filter(m => m['行业编号'] === ind['行业编号']).length;
    const riskCount = cityRisks.filter(r => r['行业编号'] === ind['行业编号']).length;
    return { '行业编号': ind['行业编号'], '细分行业': ind['细分行业'], 职业数: jobCount, 模式数: modeCount, 城市风险数: riskCount };
  });

  return {
    totals: { 行业: industries.length, 门类: Object.keys(categories).length, 职业: jobs.length, 经营模式: modes.length, 城市: cities.length, 城市风险记录: cityRisks.length },
    categories,
    riskByLevel,
    riskByCity,
    industryRisk,
    coverage,
  };
}

// ------------------------------------------------------------------ 搜索
function buildSearch(q) {
  if (!q) return { industries: [], jobs: [], modes: [], city_risks: [], cities: [] };
  const lower = q.toLowerCase();
  const results = { industries: [], jobs: [], modes: [], city_risks: [], cities: [] };

  for (const ind of SEED.industries) {
    const fields = F.industries_all;
    const hitFields = fields.filter(f => String(ind[f] || '').toLowerCase().includes(lower));
    if (hitFields.length) {
      results.industries.push({ key: ind['行业编号'], title: ind['细分行业'], sub: ind['行业门类'] + ' · ' + ind['行业编号'], hitFields });
      if (results.industries.length >= 40) break;
    }
  }

  for (const job of SEED.jobs) {
    const fields = F.jobs_all;
    const hitFields = fields.filter(f => String(job[f] || '').toLowerCase().includes(lower));
    if (hitFields.length) {
      results.jobs.push({ key: job['行业编号'] + '|' + job['常见职位'], title: job['常见职位'] + '（' + job['行业编号'] + '）', sub: job['行业编号'], hitFields });
      if (results.jobs.length >= 40) break;
    }
  }

  for (const mode of SEED.modes) {
    const fields = F.modes_all;
    const hitFields = fields.filter(f => String(mode[f] || '').toLowerCase().includes(lower));
    if (hitFields.length) {
      results.modes.push({ key: mode['行业编号'] + '|' + mode['细分模式'], title: mode['细分模式'] + '（' + mode['行业编号'] + '）', sub: mode['行业编号'], hitFields });
      if (results.modes.length >= 40) break;
    }
  }

  for (const r of SEED.city_risks) {
    const fields = F.risks_all;
    const hitFields = fields.filter(f => String(r[f] || '').toLowerCase().includes(lower));
    if (hitFields.length) {
      results.city_risks.push({ key: r['行业编号'] + '|' + r['城市'], title: r['城市'] + ' · ' + r['行业编号'], sub: r['风险层级'], hitFields });
      if (results.city_risks.length >= 40) break;
    }
  }

  for (const c of SEED.cities) {
    const fields = F.cities_all;
    const hitFields = fields.filter(f => String(c[f] || '').toLowerCase().includes(lower));
    if (hitFields.length) {
      results.cities.push({ key: c['序号'] + '|' + c['城市名称'], title: c['城市名称'], sub: c['定位标签'] || '', hitFields });
      if (results.cities.length >= 40) break;
    }
  }

  return results;
}

// ------------------------------------------------------------------ 集合查询
function buildCollection(name, params) {
  let rows = SEED[name] ? [...SEED[name]] : [];
  const q = params.get('q');
  if (q) {
    const lower = q.toLowerCase();
    rows = rows.filter(r => Object.values(r).some(v => String(v || '').toLowerCase().includes(lower)));
  }
  const page = Number(params.get('page') || 1);
  const size = Number(params.get('size') || 50);
  const total = rows.length;
  const start = (page - 1) * size;
  rows = rows.slice(start, start + size);
  return { rows, total };
}

// ------------------------------------------------------------------ 提示
function toast(title, msg, type) {
  const w = $('#toastWrap');
  const el = document.createElement('div');
  el.className = 'toast' + (type ? ' ' + type : '');
  el.innerHTML = `<b>${esc(title)}</b>` + (msg ? `<small>${esc(msg)}</small>` : '');
  w.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = '.3s'; setTimeout(() => el.remove(), 320); }, type === 'err' ? 4200 : 2600);
}

// ------------------------------------------------------------------ 弹层
function modal(title, bodyHtml, footHtml, opts) {
  opts = opts || {};
  $('#modalTitle').textContent = title;
  $('#modalBody').innerHTML = bodyHtml;
  $('#modalFoot').innerHTML = footHtml || '';
  $('#modalBox').className = 'modal' + (opts.wide ? ' wide' : '');
  $('#modalMask').hidden = false;
  return $('#modalBody');
}
function closeModal() { $('#modalMask').hidden = true; $('#modalBody').innerHTML = ''; $('#modalFoot').innerHTML = ''; }
$('#modalClose').onclick = closeModal;
$('#modalMask').onclick = (e) => { if (e.target === $('#modalMask')) closeModal(); };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#modalMask').hidden) closeModal(); });

// ------------------------------------------------------------------ 风险层级
function lvClass(s) {
  s = String(s || '');
  if (!s || s === '—') return 'lv-X';
  if (s.startsWith('E')) return 'lv-E';
  if (s.startsWith('D')) return 'lv-D';
  if (s.startsWith('C-D')) return 'lv-CD';
  if (s.startsWith('C')) return 'lv-C';
  if (s.startsWith('B-C')) return 'lv-BC';
  if (s.startsWith('B')) return 'lv-B';
  if (s.startsWith('A')) return 'lv-A';
  return 'lv-X';
}
function heatClass(s) { return lvClass(s).replace('lv-', 'hc-'); }

// ------------------------------------------------------------------ 字段定义
const F = {
  industries_01: ['细分行业', '典型经营主体形态', '必备证照资质', '常见经营规模', '订单与客户来源', '典型融资用途'],
  industries_03: ['前景趋势判断', '毛利率区间', '净利率区间', '旺季月份', '淡季月份', '季节性资金缺口高峰', '主要经营风险', '政策与外部驱动'],
  industries_all: ['行业编号', '行业门类', '细分行业', '典型经营主体形态', '必备证照资质', '常见经营规模', '订单与客户来源', '典型融资用途',
    '前景趋势判断', '毛利率区间', '净利率区间', '旺季月份', '淡季月份', '季节性资金缺口高峰', '主要经营风险', '政策与外部驱动', '职业标签串'],
  modes_02: ['运作方式', '盈利逻辑', '上下游与结算回款方式', '成本结构', '资金需求特点与周期', '授信关注要点'],
  modes_all: ['行业编号', '细分模式', '运作方式', '盈利逻辑', '上下游与结算回款方式', '成本结构', '资金需求特点与周期', '授信关注要点'],
  jobs_04: ['这个岗位每天干什么', '审核时怎么问', '能查到哪些证据', '真干过的人怎么答', '没干过的破绽', '审批要点'],
  jobs_all: ['行业编号', '常见职位', '这个岗位每天干什么', '审核时怎么问', '能查到哪些证据', '真干过的人怎么答', '没干过的破绽', '审批要点'],
  risks_all: ['行业编号', '城市', '风险层级', '依据与尽调要点'],
  cities_all: ['序号', '城市名称', '定位标签'],
};

const LABEL = {
  '常见经营规模': '常见经营规模（小微口径）',
  '成本结构': '成本结构（占比）',
  '上下游与结算回款方式': '上下游与结算回款',
  '这个岗位每天干什么': '岗位每天干什么',
};
const lb = (f) => LABEL[f] || f;

// ------------------------------------------------------------------ 导航
const NAV = [
  { g: '数据分析', items: [
    { id: 'dashboard', ico: '📊', t: '数据看板' },
    { id: 'analytics', ico: '📈', t: '统计分析' },
  ]},
  { g: '知识管理', items: [
    { id: 'industries', ico: '🏢', t: '行业管理', badge: () => S.meta && S.meta.industry_count },
    { id: 'jobs', ico: '👥', t: '职业管理', badge: () => S.meta && S.meta.job_count },
    { id: 'cityrisks', ico: '🏙', t: '城市风控', badge: () => S.meta && S.meta.city_risk_count },
    { id: 'modes', ico: '🧩', t: '经营模式', badge: () => S.meta && S.meta.mode_count },
  ]},
  { g: '数据操作', items: [
    { id: 'search', ico: '🔍', t: '全局搜索' },
    { id: 'transfer', ico: '🔄', t: '导入导出' },
  ]},
];

function renderNav() {
  const nav = $('#nav');
  let h = '';
  for (const g of NAV) {
    const items = g.items;
    if (!items.length) continue;
    h += `<div class="nav-group"><div class="g-t">${esc(g.g)}</div>`;
    for (const i of items) {
      const b = i.badge ? i.badge() : null;
      h += `<div class="nav-item${S.page === i.id ? ' on' : ''}" data-page="${i.id}">
        <span class="ni">${i.ico}</span><span>${esc(i.t)}</span>
        ${b ? `<span class="badge">${b}</span>` : ''}</div>`;
    }
    h += '</div>';
  }
  nav.innerHTML = h;
  $$('.nav-item', nav).forEach((el) => { el.onclick = () => go(el.dataset.page); });
}

const PAGE_TITLE = {
  dashboard: '数据看板', analytics: '统计分析', industries: '行业管理', jobs: '职业管理',
  cityrisks: '城市风控', modes: '经营模式', search: '全局搜索', transfer: '数据导入导出',
};

function go(page) {
  S.page = page;
  $('#crumb').textContent = PAGE_TITLE[page] || page;
  $('#navToggle') && $('#navToggle').classList.remove('open');
  $('.sidebar').classList.remove('open');
  renderNav();
  const fn = PAGES[page];
  const c = $('#content');
  c.scrollTop = 0;
  if (!fn) { c.innerHTML = '<div class="empty">页面不存在</div>'; return; }
  fn(c);
}

// ================================================================== 看板
async function pageDashboard(c) {
  const q = S.dash;
  c.innerHTML = `
    <div class="qbar">
      <div class="qbox">
        <div class="qt"><span class="n">1</span>行业查询</div>
        <input type="text" id="qInd" placeholder="输入行业编号（如 JZ08）、行业名或关键词（如 劳务、火锅、软件、钢材、宠物、光伏）" value="${esc(q.industry)}">
        <div class="qmeta" id="mInd">加载中…</div>
        <div class="chipbar" id="chInd"></div>
      </div>
      <div class="qbox">
        <div class="qt"><span class="n">2</span>职业搜索</div>
        <input type="text" id="qJob" placeholder="输入职位关键词（如 技术员、店长、司机），留空显示本行业全部职位" value="${esc(q.job)}" ${q.ci.size || q.industry ? '' : 'disabled'}>
        <div class="qmeta" id="mJob">—</div>
        <div class="chipbar" id="chJob"></div>
      </div>
      <div class="qbox">
        <div class="qt"><span class="n">3</span>城市筛选</div>
        <input type="text" id="qCity" placeholder="输入城市或定位关键词（如 重庆、港口、制造），留空显示全部城市" value="${esc(q.city)}">
        <div class="qmeta" id="mCity">—</div>
        <div class="chipbar" id="chCity"></div>
      </div>
    </div>

    <div class="statusline" id="statusLine">加载中…</div>
    <div class="idbox" id="idBox"></div>
    <div id="dashBody"></div>
  `;

  const deb = debounce(() => loadDash(), 260);
  $('#qInd').oninput = (e) => { S.dash.industry = e.target.value; deb(); };
  $('#qJob').oninput = (e) => { S.dash.job = e.target.value; deb(); };
  $('#qCity').oninput = (e) => { S.dash.city = e.target.value; deb(); };
  await loadDash();
}

async function loadDash() {
  const q = S.dash;
  const p = new URLSearchParams();
  p.set('industry', q.industry); p.set('job', q.job); p.set('city', q.city);
  if (q.ci.size) p.set('ci', [...q.ci].join('|'));
  if (q.cj.size) p.set('cj', [...q.cj].join('|'));
  if (q.cc.size) p.set('cc', [...q.cc].join('|'));

  let d;
  try {
    d = (await api('/api/dashboard?' + p.toString())).data;
  } catch (e) {
    $('#dashBody').innerHTML = `<div class="empty"><span class="big">⚠️</span>${esc(e.message)}</div>`;
    return;
  }
  S.dashData = d;
  renderDash(d);
}

function renderDash(d) {
  const q = S.dash;
  $('#statusLine').innerHTML =
    `行业：<b>${esc(d.status.industry)}</b><span class="sep">｜</span>` +
    `职业：<b>${esc(d.status.job)}</b><span class="sep">｜</span>` +
    `城市：<b>${esc(d.status.city)}</b>`;

  const ind = d.industry;
  $('#idBox').innerHTML = ind ? `
    <div><div class="k">识别编号</div><div class="v code">${esc(ind['行业编号'])}</div></div>
    <div><div class="k">行业名称</div><div class="v">${esc(ind['细分行业'])}</div></div>
    <div><div class="k">行业门类</div><div class="v">${esc(ind['行业门类'])}</div></div>
    <div><div class="k">职业 / 经营模式 / 城市</div><div class="v">${d.jobs.total} / ${d.modes.length} / ${d.cities.shownCount}</div></div>
  ` : `<div><div class="k">识别编号</div><div class="v" style="color:#8a95a5">未定位</div></div>
      <div><div class="k">提示</div><div class="v" style="font-size:13px;font-weight:400;color:#5b6879">
        ${esc(d.status.industry)}</div></div>`;

  $('#mInd').innerHTML = d.resolvedCode
    ? `已定位 <b>${esc(d.industryLabel)}</b>`
    : (d.candidateTotal ? `命中 <b>${d.candidateTotal}</b> 条${d.candidateTotal > 6 ? '（显示前 6）' : ''}，点选下方标签锁定` : '无命中');
  $('#chInd').innerHTML = d.candidates.map((cb) => {
    const code = cb.split('-')[0];
    const on = code === d.resolvedCode;
    return `<span class="chip${on ? ' on' : ''}" data-code="${esc(code)}" data-label="${esc(cb)}">${esc(cb)}</span>`;
  }).join('') || '<span class="hint">—</span>';
  $$('#chInd .chip').forEach((el) => {
    el.onclick = () => {
      const code = el.dataset.code;
      if (q.ci.has(code)) q.ci.delete(code); else q.ci.add(code);
      [...q.ci].forEach((x) => { if (x !== code) q.ci.delete(x); });
      q.industry = el.dataset.label;
      $('#qInd').value = q.industry;
      loadDash();
    };
  });

  const jq = $('#qJob');
  jq.disabled = !d.resolvedCode;
  $('#mJob').innerHTML = d.resolvedCode
    ? `本行业 <b>${d.jobs.total}</b> 个职位｜命中 <b>${d.jobs.hit}</b>｜显示 <b>${d.jobs.shownCount}</b>${d.jobs.shownCount > 10 ? '（看板最多 10）' : ''}`
    : '请先选定行业';
  $('#chJob').innerHTML = d.resolvedCode
    ? d.jobs.all.map((r) => {
        const on = q.cj.has(r['常见职位']);
        const dim = !r['命中'];
        return `<span class="chip${on ? ' on' : ''}${dim ? ' dim' : ''}" data-j="${esc(r['常见职位'])}" title="${esc(r['三段式标签'] || r['常见职位'] || '')}">${esc(r['常见职位'])}</span>`;
      }).join('') || '<span class="hint">该行业暂无职位</span>'
    : '<span class="hint">—</span>';
  $$('#chJob .chip').forEach((el) => {
    el.onclick = () => {
      const jn = el.dataset.j;
      if (q.cj.has(jn)) q.cj.delete(jn); else q.cj.add(jn);
      loadDash();
    };
  });

  $('#mCity').innerHTML = `命中 <b>${d.cities.hit}</b> 个城市｜显示 <b>${d.cities.shownCount}</b>${d.cities.shownCount > 8 ? '（看板最多 8）' : ''}`;
  $('#chCity').innerHTML = d.cities.all.map((r) => {
    const on = q.cc.has(r['城市名称']);
    const dim = !r['命中'];
    return `<span class="chip${on ? ' on' : ''}${dim ? ' dim' : ''}" data-c="${esc(r['城市名称'])}" title="${esc(r['定位标签'] || '')}">${esc(r['城市名称'])}</span>`;
  }).join('');
  $$('#chCity .chip').forEach((el) => {
    el.onclick = () => {
      const cn = el.dataset.c;
      if (q.cc.has(cn)) q.cc.delete(cn); else q.cc.add(cn);
      loadDash();
    };
  });

  $('#dashBody').innerHTML =
    sec01(d) + sec02(d) + sec03(d) + sec04(d) + sec05(d);
  bindModeToggles($('#dashBody'));
}

function cardHead(no, title, sub) {
  return `<div class="card-hd"><h3><span class="no">${no}</span>${esc(title)}</h3>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;
}

function kvRows(rec, fields) {
  return fields.map((f) => {
    const v = rec[f] == null ? '' : rec[f];
    const empty = !String(v || '').trim() || String(v).trim() === '—';
    const txt = empty ? '<span style="color:#a9b3c2">—</span>' : nl2br(v);
    return `<tr><th>${esc(lb(f))}</th><td><div class="txt">${txt}</div></td></tr>`;
  }).join('');
}

function sec01(d) {
  if (!d.industry) return '';
  const k = d.industry['行业编号'];
  return `<div class="card">${cardHead('01', '行业档案', `${esc(d.industry['行业门类'])} · ${esc(k)}`)}
    <div class="card-bd tight"><table class="kv">${kvRows(d.industry, F.industries_01)}</table></div></div>`;
}

function sec02(d) {
  if (!d.resolvedCode) return '';
  const modes = d.modes || [];
  let bd;
  if (!modes.length) {
    bd = '<div class="empty"><span class="big">🧩</span>该行业暂无经营模式条目</div>';
  } else {
    bd = `<div class="grp-list">${modes.map((m, i) => {
      const k = m['行业编号'] + '|' + m['细分模式'];
      return `<div class="grp">
        <div class="grp-hd"><span class="idx">◆</span>${esc(m['细分模式'])}
          <span class="rt">第 ${i + 1} / ${modes.length} 条</span></div>
        <div class="grp-bd"><table class="kv">${kvRows(m, F.modes_02)}</table></div></div>`;
    }).join('')}</div>`;
  }
  return `<div class="card">${cardHead('02', '经营模式', `共 ${modes.length} 条${modes.length > 1 ? '（按 ◆模式名 分组）' : ''}`)}
    <div class="card-bd">${bd}</div></div>`;
}

function sec03(d) {
  if (!d.industry) return '';
  const k = d.industry['行业编号'];
  const ind = d.industry;
  const pair = (f1, f2) => `<tr><th>${esc(lb(f1))}</th>
    <td style="width:44%">${cellVal(ind[f1])}</td>
    <th style="width:96px">${esc(lb(f2))}</th>
    <td>${cellVal(ind[f2])}</td></tr>`;
  const single = (f) => `<tr><th>${esc(lb(f))}</th><td colspan="3">${cellVal(ind[f])}</td></tr>`;
  return `<div class="card">${cardHead('03', '前景 、利润 、淡旺季', '含毛利率 / 净利率 / 旺淡季')}
    <div class="card-bd tight"><table class="kv">
      ${single('前景趋势判断')}
      ${pair('毛利率区间', '净利率区间')}
      ${pair('旺季月份', '淡季月份')}
      ${single('季节性资金缺口高峰')}${single('主要经营风险')}${single('政策与外部驱动')}
    </table></div></div>`;
}

function cellVal(v) {
  const empty = !String(v || '').trim() || String(v).trim() === '—';
  return empty ? '<span style="color:#a9b3c2">—</span>' : nl2br(v);
}

function sec04(d) {
  if (!d.resolvedCode) return '';
  const shown = d.jobs.shown || [];
  let bd;
  if (!shown.length) {
    bd = `<div class="empty"><span class="big">👥</span>${esc(d.status.job)}</div>`;
  } else {
    bd = `<div class="grp-list">${shown.map((j, i) => {
      const k = j['行业编号'] + '|' + j['常见职位'];
      return `<div class="grp">
        <div class="grp-hd"><span class="idx">◆</span>${esc(j['常见职位'])}
          <span class="rt">第 ${i + 1} / ${shown.length} 条${d.jobs.shownCount > 10 ? `（本行业命中 ${d.jobs.shownCount} 个，看板显示前 10）` : ''}</span></div>
        <div class="grp-bd"><table class="kv">${kvRows(j, F.jobs_04)}</table></div></div>`;
    }).join('')}</div>`;
  }
  return `<div class="card">${cardHead('04', '在职客户岗位核实', `本行业 ${d.jobs.total} 个职位 · 显示 ${shown.length} 个`)}
    <div class="card-bd">${bd}</div></div>`;
}

function sec05(d) {
  const rows = d.cities.shown || [];
  let bd;
  if (!rows.length) {
    bd = '<div class="empty"><span class="big">🏙</span>无匹配城市</div>';
  } else {
    bd = `<div class="tbl-wrap"><table class="risk-tbl">
      <thead><tr><th>城市</th><th>风险层级</th><th>定级依据与尽调要点</th></tr></thead>
      <tbody>${rows.map((r) => `<tr>
        <td class="city">${esc(r['城市'])}<span class="loc">${esc(r['定位标签'] || '')}</span></td>
        <td class="lvcell">${d.resolvedCode
          ? `<span class="lv ${lvClass(r['风险层级'])}">${esc(r['风险层级'] || '—')}</span>`
          : '<span style="color:#a9b3c2">—</span>'}</td>
        <td class="basis">${d.resolvedCode ? nl2br(r['依据与尽调要点']) : '<span style="color:#a9b3c2">请先选定行业</span>'}</td>
      </tr>`).join('')}</tbody></table></div>`;
  }
  return `<div class="card">${cardHead('05', '城市风险分级（A 低 → E 高）',
    `${rows.length} 个城市${d.resolvedCode ? '' : ' · 未选行业'}`)}
    <div class="card-bd">${bd}
      <div class="legend">
        <span><i style="background:var(--lv-a-bg);border:1px solid var(--lv-a)"></i>A 低</span>
        <span><i style="background:var(--lv-bc-bg);border:1px solid var(--lv-bc)"></i>B / B-C 中低</span>
        <span><i style="background:var(--lv-c-bg);border:1px solid var(--lv-c)"></i>C 中等</span>
        <span><i style="background:var(--lv-cd-bg);border:1px solid var(--lv-cd)"></i>C-D 中等偏高</span>
        <span><i style="background:var(--lv-d-bg);border:1px solid var(--lv-d)"></i>D 中高</span>
        <span><i style="background:var(--lv-e-bg);border:1px solid var(--lv-e)"></i>E 高</span>
        <span style="margin-left:auto">数据口径：各市统计局 2026 年上半年发布数据，2025 年全年作基数对照；利润与淡旺季为行业经验区间</span>
      </div>
    </div></div>`;
}

function bindModeToggles(root) {
  $$('.grp-hd', root).forEach((h) => {
    h.style.cursor = 'pointer';
    h.onclick = (e) => {
      const bd = h.nextElementSibling;
      const hide = bd.style.display === 'none';
      bd.style.display = hide ? '' : 'none';
      h.style.opacity = hide ? '1' : '.62';
    };
  });
}

function debounce(fn, ms) {
  let t; return function () { clearTimeout(t); const a = arguments; t = setTimeout(() => fn.apply(this, a), ms); };
}

// ================================================================== 通用数据表
async function dataTablePage(c, cfg) {
  c.innerHTML = `
    <div class="card">
      ${cardHead(cfg.no || '', cfg.title, cfg.sub || '')}
      <div class="card-bd">
        <div class="toolbar" id="tb"></div>
        <div class="tbl-wrap" id="tw"><div class="loading"><span class="spin"></span>加载中…</div></div>
        <div class="pager" id="pg"></div>
      </div>
    </div>`;
  const st = { page: 1, size: cfg.size || 50, q: '', total: 0 };
  const tb = $('#tb');

  tb.innerHTML = `
    <input type="text" id="fQ" placeholder="关键词全文检索…">
    <span class="sp"></span>
    <span class="hint" id="cnt"></span>
    <button class="btn" id="bExp">⬇ 导出本页数据</button>
  `;
  const reload = async () => {
    const p = new URLSearchParams({ page: st.page, size: st.size });
    if (st.q) p.set('q', st.q);
    let r;
    try { r = await api(`/api/collection/${cfg.name}?` + p.toString()); }
    catch (e) { $('#tw').innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    st.total = r.total;
    $('#cnt').textContent = `共 ${r.total} 条`;
    renderRows(r.rows);
    renderPager();
  };
  function renderRows(rows) {
    if (!rows.length) { $('#tw').innerHTML = '<div class="empty"><span class="big">🗂</span>没有匹配的记录</div>'; return; }
    const cols = cfg.columns;
    $('#tw').innerHTML = `<table class="tbl"><thead><tr>${cols.map((x) => `<th>${esc(x.t)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r) => {
        const k = keyOf(cfg.name, r);
        return `<tr>${cols.map((x) => {
          const v = x.f ? x.f(r) : r[x.k];
          if (x.cls === 'lv') return `<td><span class="lv ${lvClass(v)}">${esc(v || '—')}</span></td>`;
          if (x.cls === 'code') return `<td class="code">${esc(v || '')}</td>`;
          return `<td class="${x.wrap === false ? '' : 'wrap'}">${x.raw ? v : nl2br(v)}</td>`;
        }).join('')}</tr>`;
      }).join('')}</tbody></table>`;
  }
  function renderPager() {
    const pages = Math.max(1, Math.ceil(st.total / st.size));
    $('#pg').innerHTML = `
      <button class="btn sm" id="pPrev" ${st.page <= 1 ? 'disabled' : ''}>上一页</button>
      <span>第 ${st.page} / ${pages} 页（${st.total} 条）</span>
      <button class="btn sm" id="pNext" ${st.page >= pages ? 'disabled' : ''}>下一页</button>
      <select id="pSize">${[20, 50, 100, 200, 500].map((n) => `<option value="${n}"${n === st.size ? ' selected' : ''}>${n} 条/页</option>`).join('')}</select>`;
    $('#pPrev').onclick = () => { st.page--; reload(); };
    $('#pNext').onclick = () => { st.page++; reload(); };
    $('#pSize').onchange = (e) => { st.size = Number(e.target.value); st.page = 1; reload(); };
  }

  $('#fQ').oninput = debounce((e) => { st.q = e.target.value.trim(); st.page = 1; reload(); }, 280);
  $('#bExp').onclick = () => downloadJson(cfg.name);
  await reload();
}

function keyOf(collection, r) {
  if (collection === 'industries') return r['行业编号'];
  if (collection === 'modes') return r['行业编号'] + '|' + r['细分模式'];
  if (collection === 'jobs') return r['行业编号'] + '|' + r['常见职位'];
  if (collection === 'city_risks') return r['行业编号'] + '|' + r['城市'];
  if (collection === 'cities') return r['城市名称'];
  return '';
}

function downloadJson(name) {
  let data;
  if (name === 'all') {
    data = SEED;
  } else {
    data = SEED[name] || [];
  }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `xwk_${name}_${Date.now()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast('已开始下载', a.download);
}

// ================================================================== 各管理页
const COL_INDUSTRY = { t: '行业编号', k: '行业编号', cls: 'code', wrap: false };

function pageIndustries(c) {
  return dataTablePage(c, {
    name: 'industries', no: '01', title: '行业管理（行业档案 + 前景利润淡旺季）',
    sub: `数据源 _idx · 共 ${S.meta ? S.meta.industry_count : 0} 个细分行业`,
    columns: [
      COL_INDUSTRY,
      { t: '行业门类', k: '行业门类', wrap: false },
      { t: '细分行业', k: '细分行业', wrap: false },
      { t: '典型经营主体形态', k: '典型经营主体形态' },
      { t: '必备证照资质', k: '必备证照资质' },
      { t: '常见经营规模', k: '常见经营规模' },
      { t: '订单与客户来源', k: '订单与客户来源' },
      { t: '典型融资用途', k: '典型融资用途' },
      { t: '前景趋势判断', k: '前景趋势判断' },
      { t: '毛利率', k: '毛利率区间', wrap: false },
      { t: '净利率', k: '净利率区间', wrap: false },
      { t: '旺季', k: '旺季月份' }, { t: '淡季', k: '淡季月份' },
      { t: '季节性资金缺口高峰', k: '季节性资金缺口高峰' },
      { t: '主要经营风险', k: '主要经营风险' },
      { t: '政策与外部驱动', k: '政策与外部驱动' },
    ],
  });
}

function pageJobs(c) {
  return dataTablePage(c, {
    name: 'jobs', no: '04', title: '职业管理（在职客户岗位核实）',
    sub: `数据源 _m04 · 共 ${S.meta ? S.meta.job_count : 0} 条岗位明细`,
    columns: [
      COL_INDUSTRY,
      { t: '常见职位', k: '常见职位', wrap: false, f: (r) => `<b>${esc(r['常见职位'])}</b>`, raw: true },
      { t: '岗位每天干什么', k: '这个岗位每天干什么' },
      { t: '审核时怎么问', k: '审核时怎么问' },
      { t: '能查到哪些证据', k: '能查到哪些证据' },
      { t: '真干过的人怎么答', k: '真干过的人怎么答' },
      { t: '没干过的破绽', k: '没干过的破绽' },
      { t: '审批要点', k: '审批要点' },
    ],
    size: 50,
  });
}

function pageCityRisks(c) {
  return dataTablePage(c, {
    name: 'city_risks', no: '05', title: '城市风控（行业 × 城市 风险分级）',
    sub: `共 ${S.meta ? S.meta.city_risk_count : 0} 条 = ${S.meta ? S.meta.industry_count : 0} 行业 × ${S.meta ? S.meta.city_count : 0} 城市`,
    columns: [
      COL_INDUSTRY,
      { t: '城市', k: '城市', wrap: false },
      { t: '风险层级', k: '风险层级', cls: 'lv', wrap: false },
      { t: '定级依据与尽调要点', k: '依据与尽调要点' },
    ],
    size: 50,
  });
}

function pageModes(c) {
  return dataTablePage(c, {
    name: 'modes', no: '02', title: '经营模式详解',
    sub: `数据源 _m02 · 共 ${S.meta ? S.meta.mode_count : 0} 条模式`,
    columns: [
      COL_INDUSTRY,
      { t: '细分模式', k: '细分模式', wrap: false },
      { t: '运作方式', k: '运作方式' },
      { t: '盈利逻辑', k: '盈利逻辑' },
      { t: '上下游与结算回款', k: '上下游与结算回款方式' },
      { t: '成本结构', k: '成本结构' },
      { t: '资金需求特点与周期', k: '资金需求特点与周期' },
      { t: '授信关注要点', k: '授信关注要点' },
    ],
  });
}

// ================================================================== 统计分析
async function pageAnalytics(c) {
  c.innerHTML = '<div class="loading"><span class="spin"></span>正在统计分析…</div>';
  let d;
  try { d = (await api('/api/analytics')).data; }
  catch (e) { c.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }

  const t = d.totals;
  const lv = d.riskByLevel;
  const lvTotal = Object.values(lv).reduce((a, b) => a + b, 0) || 1;

  const cats = Object.entries(d.categories).sort((a, b) => b[1].行业数 - a[1].行业数);
  const catMax = cats.length ? cats[0][1].行业数 : 1;

  const cityRows = Object.entries(d.riskByCity);
  const citySum = cityRows.map(([cn, m]) => ({
    cn, total: Object.values(m).reduce((a, b) => a + b, 0),
    high: (m['D级·中高风险'] || 0) + (m['E级·高风险'] || 0) + Object.entries(m).filter(([k]) => k.startsWith('C-D')).reduce((a, b) => a + b[1], 0),
    mid: m['C级·中等风险'] || 0,
    low: Object.entries(m).filter(([k]) => k.startsWith('A') || k.startsWith('B')).reduce((a, b) => a + b[1], 0),
    m,
  })).sort((a, b) => b.high - a.high);
  const cMax = Math.max(1, ...citySum.map((x) => x.total));

  const topRisk = d.industryRisk.filter((x) => x.风险指数 != null).slice(0, 20);
  const bestRisk = d.industryRisk.filter((x) => x.风险指数 != null).slice(-15).reverse();

  c.innerHTML = `
  <div class="stat-grid">
    <div class="stat"><div class="n">${t.行业}</div><div class="l">细分行业</div></div>
    <div class="stat g"><div class="n">${t.门类}</div><div class="l">行业门类</div></div>
    <div class="stat"><div class="n">${t.职业}</div><div class="l">岗位核实明细</div></div>
    <div class="stat g"><div class="n">${t.经营模式}</div><div class="l">经营模式条目</div></div>
    <div class="stat o"><div class="n">${t.城市}</div><div class="l">覆盖城市</div></div>
    <div class="stat r"><div class="n">${t.城市风险记录}</div><div class="l">行业×城市 分级记录</div></div>
  </div>

  <div class="card">${cardHead('A', '行业门类分布', `${t.行业} 个细分行业 / ${t.门类} 个门类`)}
    <div class="card-bd"><div class="bars">
      ${cats.map(([n, v]) => `<div class="bar-row">
        <div class="bl" title="${esc(v.编号.join('、'))}">${esc(n)}</div>
        <div class="bt"><div class="bf" style="width:${(v.行业数 / catMax * 100).toFixed(1)}%"></div></div>
        <div class="bv">${v.行业数}</div></div>`).join('')}
    </div></div></div>

  <div class="card">${cardHead('B', '全库风险层级分布', 'A 低 → E 高（按行业×城市记录数）')}
    <div class="card-bd"><div class="bars">
      ${Object.entries(lv).sort((a, b) => b[1] - a[1]).map(([n, v]) => `<div class="bar-row ${/^[DE]/.test(n) ? 'red' : /^C-D/.test(n) ? 'orange' : /^C/.test(n) ? 'gold' : 'green'}">
        <div class="bl">${esc(n)}</div>
        <div class="bt"><div class="bf" style="width:${(v / lvTotal * 100).toFixed(1)}%"></div></div>
        <div class="bv">${v} <small style="color:#8a95a5;font-weight:400">${(v / lvTotal * 100).toFixed(1)}%</small></div></div>`).join('')}
    </div></div></div>

  <div class="card">${cardHead('C', '城市风险集中度', '按 D/E 级 + C-D 级记录数排序（越高越需重点管控）')}
    <div class="card-bd"><div class="bars">
      ${citySum.map((x) => `<div class="bar-row ${x.high / x.total > .45 ? 'red' : x.high / x.total > .3 ? 'orange' : 'gold'}">
        <div class="bl">${esc(x.cn)}</div>
        <div class="bt"><div class="bf" style="width:${(x.total / cMax * 100).toFixed(1)}%"></div></div>
        <div class="bv" title="高/中高 ${x.high}｜中等 ${x.mid}｜低 ${x.low}">${x.high}<small style="color:#8a95a5;font-weight:400">/${x.total}</small></div></div>`).join('')}
    </div>
    <p class="hint" style="margin-top:10px">条形长度＝该城市全部行业记录数；数字＝「高风险（D/E 级 + C-D 级）」/「总数」。悬停可看中等与低风险明细。</p>
    </div></div>

  <div class="card">${cardHead('D', '行业风险热力矩阵', `${t.行业} 行业 × ${t.城市} 城市 · 点击单元格跳转看板`)}
    <div class="card-bd"><div class="heat-wrap" id="heatWrap"><div class="loading"><span class="spin"></span>矩阵加载中…</div></div>
      <div class="legend">
        <span><i class="hc-A"></i>A 低</span><span><i class="hc-BC"></i>B / B-C</span>
        <span><i class="hc-C"></i>C 中等</span><span><i class="hc-CD"></i>C-D 中高</span>
        <span><i class="hc-D"></i>D 中高</span><span><i class="hc-E"></i>E 高</span>
      </div>
    </div></div>

  <div class="card">${cardHead('E', '行业风险指数排行', '20 城层级平均分（A=1 → E=6，分值越高风险越大）')}
    <div class="card-bd">
      <div class="btn-row" style="margin-bottom:11px">
        <button class="btn sm on" data-rk="high">风险最高 TOP 20</button>
        <button class="btn sm" data-rk="low">风险最低 TOP 15</button>
      </div>
      <div id="rankBox"></div>
    </div></div>

  <div class="card">${cardHead('F', '数据覆盖完整性', '逐行业核对职业 / 经营模式 / 城市风险是否齐全')}
    <div class="card-bd" id="covBox"><div class="loading"><span class="spin"></span>核对中…</div></div></div>
  `;

  (async () => {
    const allRows = SEED.city_risks;
    const riskByInd = new Map();
    for (const row of allRows) {
      if (!riskByInd.has(row['行业编号'])) riskByInd.set(row['行业编号'], new Map());
      riskByInd.get(row['行业编号']).set(row['城市'], row['风险层级']);
    }
    const cityNames = (S.meta.cities || []).map((x) => x['城市名称']);
    let h = '<table class="heat"><thead><tr><th style="left:0;z-index:4;background:#f4f7fb">行业</th>'
      + cityNames.map((n) => `<th>${esc(n)}</th>`).join('') + '</tr></thead><tbody>';
    for (const a of d.industryRisk) {
      const m = riskByInd.get(a['行业编号']) || new Map();
      h += `<tr><td class="rowh" title="${esc(a['行业编号'] + ' ' + a['细分行业'])}">${esc(a['行业编号'])} ${esc(a['细分行业'])}</td>`
        + cityNames.map((cn) => {
          const v = m.get(cn) || '';
          const short = String(v).replace('级·', '').replace(/风险|中低|中高|中等/g, '');
          return `<td class="c ${heatClass(v)}" data-i="${esc(a['行业编号'])}" data-c="${esc(cn)}" title="${esc(a['行业编号'] + ' · ' + cn + '：' + v)}">${esc(short)}</td>`;
        }).join('') + '</tr>';
    }
    h += '</tbody></table>';
    $('#heatWrap').innerHTML = h;
    $$('#heatWrap td.c').forEach((td) => {
      td.onclick = () => {
        S.dash = { industry: td.dataset.i, job: '', city: td.dataset.c, ci: new Set(), cj: new Set(), cc: new Set() };
        go('dashboard');
      };
    });
  })();

  const renderRank = (mode) => {
    const list = mode === 'high' ? topRisk : bestRisk;
    const mx = Math.max(...list.map((x) => x.风险指数 || 0), 1);
    $('#rankBox').innerHTML = `<div class="bars">${list.map((x) => `<div class="bar-row ${x.风险指数 >= 4.5 ? 'red' : x.风险指数 >= 3.5 ? 'orange' : x.风险指数 >= 2.5 ? 'gold' : 'green'}">
      <div class="bl" title="${esc(x['行业编号'])}">${esc(x['行业编号'])} ${esc(x['细分行业'])}</div>
      <div class="bt"><div class="bf" style="width:${(x.风险指数 / mx * 100).toFixed(1)}%"></div></div>
      <div class="bv">${x.风险指数} <small style="color:#8a95a5;font-weight:400">${esc(x['最高风险城市'] || '')}</small></div></div>`).join('')}</div>`;
    $$('#rankBox .bar-row .bl').forEach((el, i) => {
      el.style.cursor = 'pointer';
      el.onclick = () => { S.dash = { industry: list[i]['行业编号'], job: '', city: '', ci: new Set(), cj: new Set(), cc: new Set() }; go('dashboard'); };
    });
  };
  renderRank('high');
  $$('[data-rk]').forEach((b) => { b.onclick = () => { $$('[data-rk]').forEach((x) => x.classList.remove('on')); b.classList.add('on'); renderRank(b.dataset.rk); }; });

  const cov = d.coverage;
  const bad = cov.filter((x) => x.职业数 === 0 || x.模式数 === 0 || x.城市风险数 !== t.城市);
  $('#covBox').innerHTML = `
    <div class="stat-grid" style="margin-bottom:12px">
      <div class="stat g"><div class="n">${cov.filter((x) => x.职业数 > 0).length}/${cov.length}</div><div class="l">有职业数据的行业</div></div>
      <div class="stat g"><div class="n">${cov.filter((x) => x.模式数 > 0).length}/${cov.length}</div><div class="l">有经营模式的行业</div></div>
      <div class="stat ${bad.length ? 'r' : 'g'}"><div class="n">${cov.length - bad.length}/${cov.length}</div><div class="l">三项全齐的行业</div></div>
      <div class="stat"><div class="n">${t.职业}</div><div class="l">职业明细总条数</div></div>
    </div>
    ${bad.length
      ? `<p class="hint" style="margin-bottom:8px;color:#c0392b">以下 ${bad.length} 个行业存在数据缺口：</p>
         <div class="tbl-wrap" style="max-height:260px"><table class="tbl"><thead><tr>
           <th>行业编号</th><th>细分行业</th><th>职业数</th><th>模式数</th><th>城市风险数</th></tr></thead>
           <tbody>${bad.map((x) => `<tr><td class="code">${esc(x['行业编号'])}</td><td>${esc(x['细分行业'])}</td>
             <td>${x.职业数 === 0 ? '<span class="tag red">缺</span>' : x.职业数}</td>
             <td>${x.模式数 === 0 ? '<span class="tag red">缺</span>' : x.模式数}</td>
             <td>${x.城市风险数 !== t.城市 ? `<span class="tag gold">${x.城市风险数}/${t.城市}</span>` : x.城市风险数}</td></tr>`).join('')}</tbody></table></div>`
      : '<p class="hint" style="color:#0b6f56">✓ 全部行业的职业、经营模式、城市风险三项数据均齐全，无缺口。</p>'}
  `;
}

// ================================================================== 全局搜索
function pageSearch(c) {
  c.innerHTML = `
    <div class="card">${cardHead('🔍', '全局搜索', '跨行业 / 职业 / 经营模式 / 城市风险 / 城市 五类数据')}
      <div class="card-bd">
        <div class="toolbar">
          <input type="text" id="gsQ" placeholder="输入关键词，如：挂靠、社保、光伏贷、闭水试验、广联达、重庆、预收款…" style="flex:1;min-width:280px">
          <button class="btn green" id="gsBtn">搜索</button>
        </div>
        <div id="gsRes"><div class="empty"><span class="big">🔍</span>输入关键词开始检索<br><small>支持按行话、证件名、风险点、城市名等任意字段全文匹配</small></div></div>
      </div></div>`;
  const run = async () => {
    const q = $('#gsQ').value.trim();
    if (!q) return;
    $('#gsRes').innerHTML = '<div class="loading"><span class="spin"></span>检索中…</div>';
    let r;
    try { r = await api('/api/search?q=' + encodeURIComponent(q)); }
    catch (e) { $('#gsRes').innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    const res = r.results;
    const groups = [
      ['industries', '🏢 行业档案', 'industries'],
      ['jobs', '👥 职业核实', 'jobs'],
      ['modes', '🧩 经营模式', 'modes'],
      ['city_risks', '🏙 城市风险', 'cityrisks'],
      ['cities', '📍 城市', 'cityrisks'],
    ];
    let total = 0;
    let h = '';
    for (const [k, t, page] of groups) {
      const arr = res[k] || [];
      if (!arr.length) continue;
      total += arr.length;
      h += `<div class="sr-group"><div class="gt">${esc(t)}<span class="c">${arr.length}</span></div>
        ${arr.map((x) => `<div class="sr-item" data-page="${page}" data-k="${esc(x.key)}">
          <div class="t">${hlText(x.title, q)}</div>
          <div class="s">${esc(x.sub || '')}</div>
          <div class="hf">${x.hitFields.map((f) => `<span class="tag gray">${esc(lb(f))}</span>`).join('')}</div>
        </div>`).join('')}</div>`;
    }
    $('#gsRes').innerHTML = total
      ? `<p class="hint" style="margin-bottom:11px">关键词「<b>${esc(q)}</b>」共命中 <b>${total}</b> 条（每类最多显示 40 条），点击可跳转到看板定位。</p>${h}`
      : `<div class="empty"><span class="big">🈳</span>没有找到包含「${esc(q)}」的内容</div>`;
    $$('#gsRes .sr-item').forEach((el) => {
      el.onclick = () => {
        const k = el.dataset.k;
        if (el.dataset.page === 'cityrisks') {
          const parts = k.split('|');
          S.dash = { industry: parts[0] || '', job: '', city: parts[1] || '', ci: new Set(), cj: new Set(), cc: new Set() };
        } else {
          S.dash = { industry: k.split('|')[0], job: '', city: '', ci: new Set(), cj: new Set(), cc: new Set() };
        }
        go('dashboard');
      };
    });
  };
  $('#gsBtn').onclick = run;
  $('#gsQ').onkeydown = (e) => { if (e.key === 'Enter') run(); };
  $('#gsQ').focus();
}

function hlText(text, kw) {
  const t = esc(text);
  if (!kw) return t;
  const k = esc(kw).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  try { return t.replace(new RegExp('(' + k + ')', 'gi'), '<span class="hl">$1</span>'); }
  catch { return t; }
}

// ================================================================== 导入导出
function pageTransfer(c) {
  const m = S.meta;
  c.innerHTML = `
  <div class="card">${cardHead('📤', '数据导出', '导出当前生效数据')}
    <div class="card-bd">
      <div class="btn-row">
        <button class="btn green" data-exp="all">导出全部数据</button>
        <button class="btn" data-exp="industries">行业档案 (${m.industry_count})</button>
        <button class="btn" data-exp="modes">经营模式 (${m.mode_count})</button>
        <button class="btn" data-exp="jobs">职业明细 (${m.job_count})</button>
        <button class="btn" data-exp="city_risks">城市风险 (${m.city_risk_count})</button>
        <button class="btn" data-exp="cities">城市 (${m.city_count})</button>
      </div>
      <p class="hint" style="margin-top:10px">导出为 UTF-8 JSON，可直接用于备份或迁移到其他实例。</p>
    </div></div>

  <div class="card">${cardHead('📥', '数据导入', '静态部署模式不支持在线导入')}
    <div class="card-bd">
      <div class="empty"><span class="big">🔒</span>当前为静态部署（GitHub Pages），不支持在线导入数据<br><small>如需导入数据，请在本地运行完整 Node.js 版本</small></div>
    </div></div>

  <div class="card">${cardHead('🧬', '数据来源说明', '')}
    <div class="card-bd">
      <table class="kv">
        <tr><th>源文件</th><td>${esc(m.source)}</td></tr>
        <tr><th>行业档案 / 前景利润</th><td><code>_idx</code> 表（99 个细分行业 × 16 个字段）</td></tr>
        <tr><th>经营模式</th><td><code>_m02</code> 表（${m.mode_count} 条模式）</td></tr>
        <tr><th>职业核实明细</th><td><code>_m04</code> 表（419 条）＋ 补写 19 个行业（109 条）＝ ${m.job_count} 条<br>
          <span class="tag new">补写行业</span> ${esc((m.supplemented_19 || []).join('、'))}</td></tr>
        <tr><th>城市风险分级</th><td><code>00_整合明细</code> 表 AF/AG 列 —— 这是 Excel 看板 05 区块公式（22表 N/O 列）的真实取值路径，
          <b>不是</b> <code>_idx</code> 的层级列（两者存在 504 处层级差异，已按看板实际显示口径采用）</td></tr>
        <tr><th>城市清单</th><td><code>22_城市选择·搜索勾选</code> 表（20 个城市）</td></tr>
        <tr><th>字段改名</th><td>「面签时怎么问」已统一改为「<b>审核时怎么问</b>」</td></tr>
      </table>
    </div></div>`;

  $$('[data-exp]').forEach((b) => { b.onclick = () => downloadJson(b.dataset.exp); });
}

// ================================================================== 工具
function fmt(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function trunc(v, n) {
  const s = String(v == null ? '' : v);
  return s.length > n ? s.slice(0, n) + '…' : s;
}

const PAGES = {
  dashboard: pageDashboard, analytics: pageAnalytics, industries: pageIndustries,
  jobs: pageJobs, cityrisks: pageCityRisks, modes: pageModes,
  search: pageSearch, transfer: pageTransfer,
};

// ================================================================== 启动
async function refreshMeta() {
  try { S.meta = (await api('/api/meta')).meta; } catch (e) { /* 未登录时忽略 */ }
  if (S.meta) {
    $('#metaMini').innerHTML = `<b>${S.meta.industry_count}</b> 行业 · <b>${S.meta.job_count}</b> 职业<br>
      <b>${S.meta.city_count}</b> 城市 · <b>${S.meta.mode_count}</b> 模式<br>
      <span style="opacity:.75">源：${esc(S.meta.source)}</span>`;
  }
}

function showApp() {
  $('#loginView').style.display = 'none';
  $('#appView').hidden = false;
  const dn = S.user.display_name || S.user.username;
  $('#userName').textContent = dn;
  $('#userRole').textContent = '管理员';
  $('#userAvatar').textContent = dn.slice(0, 1).toUpperCase();
  $('#editFlag').style.display = 'none';
  renderNav();
  go(S.page || 'dashboard');
}

function doLogout(callApi) {
  if (callApi !== false) api('/api/logout', { method: 'POST' }).catch(() => {});
  S.token = ''; S.user = null;
  localStorage.removeItem('xwk_token');
  $('#appView').hidden = true;
  $('#loginView').style.display = '';
  $('#loginPass').value = '';
}

$('#loginForm').onsubmit = async (e) => {
  e.preventDefault();
  $('#loginErr').textContent = '';
  $('#loginBtn').disabled = true;
  $('#loginBtn').textContent = '登录中…';
  try {
    const r = await api('/api/login', {
      method: 'POST',
      body: { username: $('#loginUser').value.trim(), password: $('#loginPass').value },
    });
    S.token = r.token; S.user = r.user;
    localStorage.setItem('xwk_token', r.token);
    await refreshMeta();
    showApp();
    toast('登录成功', `${r.user.display_name || r.user.username}`);
  } catch (err) {
    $('#loginErr').textContent = err.message;
    $('#loginPass').select();
  } finally {
    $('#loginBtn').disabled = false;
    $('#loginBtn').textContent = '登 录';
  }
};

function openPwdModal(force) {
  modal(force ? '首次登录 · 请修改初始密码' : '修改我的密码', `
    <div class="fld"><span>原密码</span><input type="password" id="pw0" autocomplete="current-password"></div>
    <div class="fld"><span>新密码（至少 8 位）</span><input type="password" id="pw1" autocomplete="new-password"></div>
    <div class="fld"><span>确认新密码</span><input type="password" id="pw2" autocomplete="new-password"></div>
  `, `<button class="btn" id="pwC">取消</button><button class="btn green" id="pwS">确认修改</button>`);
  $('#pwC').onclick = closeModal;
  $('#pwS').onclick = async () => {
    const a = $('#pw0').value, b = $('#pw1').value, d = $('#pw2').value;
    if (b.length < 8) { toast('新密码至少 8 位', '', 'warn'); return; }
    if (b !== d) { toast('两次输入的新密码不一致', '', 'warn'); return; }
    try {
      await api('/api/change-password', { method: 'POST', body: { old_password: a, new_password: b } });
      S.user.must_change = false;
      toast('密码已修改', '下次登录请使用新密码');
      closeModal();
    } catch (e) { toast('修改失败', e.message, 'err'); }
  };
}

$$('.usermenu button').forEach((b) => {
  b.onclick = (e) => {
    e.stopPropagation();
    $('.usermenu').classList.remove('show');
    if (b.dataset.act === 'logout') { if (confirm('确定退出登录？')) doLogout(true); }
    if (b.dataset.act === 'pwd') openPwdModal(false);
  };
});
$('.userbox').onclick = (e) => { e.stopPropagation(); $('.usermenu').classList.toggle('show'); };
document.addEventListener('click', () => $('.usermenu').classList.remove('show'));
$('#navToggle').onclick = () => $('.sidebar').classList.toggle('open');

(async function boot() {
  if (!S.token) return;
  try {
    S.user = (await api('/api/me')).user;
    if (!S.user) { S.token = ''; localStorage.removeItem('xwk_token'); return; }
    await refreshMeta();
    showApp();
  } catch (e) {
    S.token = ''; localStorage.removeItem('xwk_token');
  }
})();
