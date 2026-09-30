/* ============================================================
   小微行业知识库看板 V3 · 纯静态版
   数据全部内嵌，无后端依赖
   ============================================================ */
'use strict';

// ------------------------------------------------------------------ 数据合并
// 数据兼容：如果salary没有trend字段，从years字段生成
if (window.XWK_DATA_8 && window.XWK_DATA_8.salary) {
  for (const key in window.XWK_DATA_8.salary) {
    const sd = window.XWK_DATA_8.salary[key];
    if (!sd) continue;
    if (sd.years && !sd.trend) {
      sd.trend = {};
      for (const yr in sd.years) {
        const d = sd.years[yr];
        sd.trend[yr] = {
          min: d.monthly_min || 0,
          max: d.monthly_max || 0,
          median: d.monthly_median || 0,
          annual: d.annual || 0,
          growth_rate: d.growth_rate || '',
        };
      }
    }
    if (sd.annual && !sd.annual_median) sd.annual_median = sd.annual;
  }
}
if (window.XWK_DATA_9 && window.XWK_DATA_9.salary) {
  for (const key in window.XWK_DATA_9.salary) {
    const sd = window.XWK_DATA_9.salary[key];
    if (!sd) continue;
    if (sd.years && !sd.trend) {
      sd.trend = {};
      for (const yr in sd.years) {
        const d = sd.years[yr];
        sd.trend[yr] = {
          min: d.monthly_min || 0,
          max: d.monthly_max || 0,
          median: d.monthly_median || 0,
          annual: d.annual || 0,
          growth_rate: d.growth_rate || '',
        };
      }
    }
    if (sd.annual && !sd.annual_median) sd.annual_median = sd.annual;
  }
}

const DB = {
  meta: window.XWK_DATA_1 ? window.XWK_DATA_1.meta : {},
  industries: window.XWK_DATA_1 ? window.XWK_DATA_1.industries : [],
  modes: window.XWK_DATA_1 ? window.XWK_DATA_1.modes : [],
  cities: window.XWK_DATA_1 ? window.XWK_DATA_1.cities : [],
  jobs: [
    ...(window.XWK_DATA_2 ? window.XWK_DATA_2.jobs : []),
    ...(window.XWK_DATA_3 ? window.XWK_DATA_3.jobs : []),
    ...(window.XWK_DATA_4 ? window.XWK_DATA_4.jobs : []),
    ...(window.XWK_DATA_5 ? window.XWK_DATA_5.jobs : []),
  ],
  city_risks: [
    ...(window.XWK_DATA_6 ? window.XWK_DATA_6.city_risks : []),
    ...(window.XWK_DATA_7 ? window.XWK_DATA_7.city_risks : []),
  ],
  salary: {
    ...(window.XWK_DATA_8 ? window.XWK_DATA_8.salary : {}),
    ...(window.XWK_DATA_9 ? window.XWK_DATA_9.salary : {}),
  },
  city_factors: window.XWK_DATA_8 ? window.XWK_DATA_8.city_factors : {},
};

// localStorage 编辑覆盖层
const EDITS_KEY = 'xwk_edits_v3';
function loadEdits() { try { return JSON.parse(localStorage.getItem(EDITS_KEY) || '{}'); } catch { return {}; } }
function saveEdits(e) { localStorage.setItem(EDITS_KEY, JSON.stringify(e)); }
let EDITS = loadEdits();

function applyEdits(collection, records) {
  const ov = EDITS[collection];
  if (!ov) return records;
  return records.map(r => {
    const k = keyOf(collection, r);
    return ov[k] ? { ...r, ...ov[k] } : r;
  });
}

// ------------------------------------------------------------------ 状态
const S = {
  user: null,
  page: 'dashboard',
  dash: { industry: '', job: '', city: '', ci: new Set(), cj: new Set(), cc: new Set(), queried: false },
  cache: {},
};

const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const nl2br = (v) => esc(v).replace(/\n/g, '<br>');

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
}
function closeModal() { $('#modalMask').hidden = true; $('#modalBody').innerHTML = ''; $('#modalFoot').innerHTML = ''; }
$('#modalClose').onclick = closeModal;
$('#modalMask').onclick = (e) => { if (e.target === $('#modalMask')) closeModal(); };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#modalMask').hidden) closeModal(); });

// ------------------------------------------------------------------ 风险层级
function normLv(lv) {
  if (!lv) return 'C';
  lv = String(lv).trim();
  if (['A','B','C','D'].includes(lv)) return lv;
  if (lv.startsWith('A-B') || lv.startsWith('A-')) return 'A';
  if (lv.startsWith('B-C') || lv.startsWith('B-')) return 'B';
  if (lv.startsWith('C-D') || lv.startsWith('C-')) return 'C';
  if (lv.startsWith('D-') || lv.startsWith('E')) return 'D';
  const m = lv.match(/^([A-D])/);
  return m ? m[1] : 'C';
}
function lvClass(s) {
  s = normLv(s);
  if (s === '—') return 'lv-X';
  if (s.startsWith('D')) return 'lv-D';
  if (s.startsWith('C')) return 'lv-C';
  if (s.startsWith('B')) return 'lv-B';
  if (s.startsWith('A')) return 'lv-A';
  return 'lv-X';
}
function heatClass(s) { return lvClass(s).replace('lv-', 'hc-'); }

// ------------------------------------------------------------------ 字段定义
const F = {
  industries_01: ['细分行业', '典型经营主体形态', '必备证照资质', '常见经营规模', '订单与客户来源', '典型融资用途'],
  industries_03: ['前景趋势判断', '毛利率区间', '净利率区间', '旺季月份', '淡季月份', '季节性资金缺口高峰', '主要经营风险', '政策与外部驱动'],
  modes_02: ['运作方式', '盈利逻辑', '上下游与结算回款方式', '成本结构', '资金需求特点与周期', '授信关注要点'],
  jobs_04: ['这个岗位每天干什么', '审核时怎么问', '能查到哪些证据', '真干过的人怎么答', '没干过的破绽', '审批要点'],
};
const LABEL = {
  '常见经营规模': '常见经营规模（小微口径）',
  '成本结构': '成本结构（占比）',
  '上下游与结算回款方式': '上下游与结算回款',
  '这个岗位每天干什么': '岗位每天干什么',
};
const lb = (f) => LABEL[f] || f;

function keyOf(collection, r) {
  if (collection === 'industries') return r['行业编号'];
  if (collection === 'modes') return r['行业编号'] + '|' + r['细分模式'];
  if (collection === 'jobs') return r['行业编号'] + '|' + r['常见职位'];
  if (collection === 'city_risks') return r['行业编号'] + '|' + r['城市'];
  if (collection === 'cities') return r['城市名称'];
  return '';
}

// ------------------------------------------------------------------ 导航
const NAV = [
  { g: '数据分析', items: [
    { id: 'dashboard', ico: '📊', t: '数据看板' },
    { id: 'ana-industry', ico: '🏢', t: '行业分析' },
    { id: 'ana-job', ico: '👥', t: '职业分析' },
    { id: 'ana-city', ico: '🏙', t: '城市分析' },
    { id: 'ana-salary', ico: '💰', t: '薪资分析' },
    { id: 'ana-risk', ico: '⚠', t: '风险分析' },
    { id: 'ana-finance', ico: '📈', t: '资金分析' },
  ]},
  { g: '数据操作', items: [
    { id: 'search', ico: '🔍', t: '全局搜索' },
    { id: 'dataupdate', ico: '🔄', t: '数据更新' },
  ]},
];

function renderNav() {
  const nav = $('#nav');
  let h = '';
  for (const g of NAV) {
    h += `<div class="nav-group"><div class="g-t">${esc(g.g)}</div>`;
    for (const i of g.items) {
      const b = i.badge ? i.badge() : null;
      h += `<div class="nav-item${S.page === i.id ? ' on' : ''}" data-page="${i.id}">
        <span class="ni">${i.ico}</span><span>${esc(i.t)}</span>
        ${b != null ? `<span class="badge">${b}</span>` : ''}</div>`;
    }
    h += '</div>';
  }
  nav.innerHTML = h;
  $$('.nav-item', nav).forEach((el) => {
    el.onclick = () => { go(el.dataset.page); };
  });
}

const PAGE_TITLE = {
  dashboard: '数据看板', 'ana-industry': '行业分析', 'ana-job': '职业分析',
  'ana-city': '城市分析', 'ana-salary': '薪资分析', 'ana-risk': '风险分析',
  'ana-finance': '资金分析',
  analytics: '分析中心', industries: '行业管理', jobs: '职业管理',
  cityrisks: '城市风控', modes: '经营模式', search: '全局搜索', dataupdate: '数据更新',
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

// ------------------------------------------------------------------ 登录
const ACCOUNTS = [
  { user: 'admin', pass: 'wt1201263', name: '管理员', role: 'admin', can_edit: true, can_manage: true },
  { user: 'gaoyuxi', pass: 'wt1201263', name: '高宇欣', role: 'admin', can_edit: true, can_manage: true },
];

function doLogin() {
  const u = ($('#loginUser').value || '').trim();
  const p = ($('#loginPass').value || '');
  const acc = ACCOUNTS.find(a => a.user === u && a.pass === p);
  if (!acc) {
    const errEl = $('#loginErr');
    if (errEl) errEl.textContent = '账号或密码不正确';
    return false;
  }
  try { localStorage.removeItem('xwk_edits_v3'); localStorage.removeItem('xwk_saved_v2'); localStorage.removeItem('xwk_recent_v2'); } catch(e) {}
  S.user = acc;
  const lv = $('#loginView');
  const av = $('#appView');
  if (lv) lv.hidden = true;
  if (av) av.hidden = false;
  const unEl = $('#userName');
  const urEl = $('#userRole');
  const uaEl = $('#userAvatar');
  if (unEl) unEl.textContent = acc.name;
  if (urEl) urEl.textContent = acc.role === 'admin' ? '管理员' : '浏览者';
  if (uaEl) uaEl.textContent = acc.name[0];
  try { renderNav(); } catch(e) { console.error('renderNav error:', e); }
  try { renderMeta(); } catch(e) { console.error('renderMeta error:', e); }
  try { go('dashboard'); } catch(e) { console.error('go error:', e); }
  return false;
}

$('#loginForm').onsubmit = (e) => { e.preventDefault(); return doLogin(); };
$('#loginBtn').onclick = (e) => { e.preventDefault(); return doLogin(); };
$('#loginPass').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doLogin(); } });

$('#userMenu').onclick = (e) => {
  if (e.target.dataset.act === 'logout') {
    S.user = null;
    $('#appView').hidden = true;
    $('#loginView').hidden = false;
    $('#loginUser').value = '';
    $('#loginPass').value = '';
  }
};
$('.userbox').onclick = () => $('#userMenu').classList.toggle('show');
document.addEventListener('click', (e) => {
  if (!e.target.closest('.userbox')) $('#userMenu').classList.remove('show');
});

$('#navToggle').onclick = () => $('.sidebar').classList.toggle('open');

function renderMeta() {
  const m = DB.meta;
  $('#metaMini').innerHTML = `<b>${m.industry_count}</b> 行业 · <b>${m.job_count}</b> 职业 · <b>${m.city_count}</b> 城市`;
  $('#dataUpdate').innerHTML = `<span class="dot"></span>数据更新：${new Date().toLocaleDateString('zh-CN')}`;
}

// ================================================================== 看板
function pageDashboard(c) {
  const q = S.dash;
  const inds = DB.industries, jobs = DB.jobs, risks = DB.city_risks, salary = DB.salary;
  const cities = DB.cities;
  const catCount = new Set(inds.map(i => i['行业门类'])).size;
  const highRisk = risks.filter(r => normLv(r['风险层级']) === 'D').length;
  const highDemand = Object.values(salary).filter(s => s.demand === '高').length;
  const avgSalary = Math.round(Object.values(salary).reduce((a,s) => a + (s.monthly_median||0), 0) / Math.max(1, Object.keys(salary).length));

  c.innerHTML = `
    <div class="dash-stats">
      <div class="stat-card s-blue">
        <div class="stat-glow"></div>
        <div class="stat-top"><div class="stat-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-4"/><path d="M9 9v.01M9 12v.01M9 15v.01M9 18v.01"/></svg></div><div class="stat-tag">行业</div></div>
        <div class="stat-val">${inds.length}</div>
        <div class="stat-lbl">细分行业</div>
        <div class="stat-spark"><div class="sp-bar" style="height:40%"></div><div class="sp-bar" style="height:65%"></div><div class="sp-bar" style="height:50%"></div><div class="sp-bar" style="height:80%"></div><div class="sp-bar" style="height:60%"></div><div class="sp-bar" style="height:100%"></div></div>
        <div class="stat-sub">${catCount}个门类</div>
      </div>
      <div class="stat-card s-green">
        <div class="stat-glow"></div>
        <div class="stat-top"><div class="stat-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg></div><div class="stat-tag">职业</div></div>
        <div class="stat-val">${jobs.length}</div>
        <div class="stat-lbl">职业岗位</div>
        <div class="stat-spark"><div class="sp-bar" style="height:55%"></div><div class="sp-bar" style="height:70%"></div><div class="sp-bar" style="height:45%"></div><div class="sp-bar" style="height:90%"></div><div class="sp-bar" style="height:75%"></div><div class="sp-bar" style="height:85%"></div></div>
        <div class="stat-sub">${highDemand}个高需求</div>
      </div>
      <div class="stat-card s-purple">
        <div class="stat-glow"></div>
        <div class="stat-top"><div class="stat-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg></div><div class="stat-tag">城市</div></div>
        <div class="stat-val">${cities.length}</div>
        <div class="stat-lbl">覆盖城市</div>
        <div class="stat-spark"><div class="sp-bar" style="height:60%"></div><div class="sp-bar" style="height:50%"></div><div class="sp-bar" style="height:85%"></div><div class="sp-bar" style="height:70%"></div><div class="sp-bar" style="height:95%"></div><div class="sp-bar" style="height:55%"></div></div>
        <div class="stat-sub">${risks.length}条风险记录</div>
      </div>
      <div class="stat-card s-orange">
        <div class="stat-glow"></div>
        <div class="stat-top"><div class="stat-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg></div><div class="stat-tag">薪资</div></div>
        <div class="stat-val">${(avgSalary/1000).toFixed(1)}<span class="stat-unit">k</span></div>
        <div class="stat-lbl">平均月薪</div>
        <div class="stat-spark"><div class="sp-bar" style="height:35%"></div><div class="sp-bar" style="height:50%"></div><div class="sp-bar" style="height:60%"></div><div class="sp-bar" style="height:75%"></div><div class="sp-bar" style="height:85%"></div><div class="sp-bar" style="height:100%"></div></div>
        <div class="stat-sub">基准中位数</div>
      </div>
      <div class="stat-card s-red">
        <div class="stat-glow"></div>
        <div class="stat-top"><div class="stat-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div><div class="stat-tag">风控</div></div>
        <div class="stat-val">${highRisk}</div>
        <div class="stat-lbl">高风险记录</div>
        <div class="stat-spark"><div class="sp-bar" style="height:30%"></div><div class="sp-bar" style="height:45%"></div><div class="sp-bar" style="height:25%"></div><div class="sp-bar" style="height:60%"></div><div class="sp-bar" style="height:40%"></div><div class="sp-bar" style="height:35%"></div></div>
        <div class="stat-sub">D级</div>
      </div>
    </div>

    <div class="qbar">
      <div class="qbox">
        <div class="qt"><span class="n">1</span>行业查询</div>
        <input type="text" id="qInd" name="off-qInd" autocomplete="off" placeholder="输入行业编号、名称或关键词（如 劳务、火锅、软件）" value="${esc(q.industry)}">
        <div class="qmeta" id="mInd">输入关键词后点选下方标签</div>
        <div class="chipbar" id="chInd"></div>
        <div class="qhint" id="hInd"></div>
      </div>
      <div class="qbox">
        <div class="qt"><span class="n">2</span>职业搜索</div>
        <input type="text" id="qJob" name="off-qJob" autocomplete="off" placeholder="输入职位关键词（如 技术员、店长、司机）" value="${esc(q.job)}" ${q.ci.size ? '' : 'disabled'}>
        <div class="qmeta" id="mJob">—</div>
        <div class="chipbar" id="chJob"></div>
        <div class="qhint" id="hJob"></div>
      </div>
      <div class="qbox">
        <div class="qt"><span class="n">3</span>城市筛选</div>
        <input type="text" id="qCity" name="off-qCity" autocomplete="off" placeholder="输入城市或定位关键词（如 重庆、港口）" value="${esc(q.city)}">
        <div class="qmeta" id="mCity">—</div>
        <div class="chipbar" id="chCity"></div>
        <div class="qhint" id="hCity"></div>
      </div>
    </div>

    <div class="statusline" id="statusLine">
      <span>请选择筛选条件后点击「查询数据」</span>
      <span class="act">
        <button class="btn sm" id="bReset">重置全部</button>
        <button class="btn green sm" id="bQuery">查询数据</button>
      </span>
    </div>
    <div id="dashBody"></div>
  `;

  const deb = debounce(() => updateChips(), 220);
  $('#qInd').oninput = (e) => { S.dash.industry = e.target.value; deb(); };
  $('#qJob').oninput = (e) => { S.dash.job = e.target.value; deb(); };
  $('#qCity').oninput = (e) => { S.dash.city = e.target.value; deb(); };
  $('#bReset').onclick = () => {
    S.dash = { industry: '', job: '', city: '', ci: new Set(), cj: new Set(), cc: new Set(), queried: false };
    go('dashboard');
  };
  $('#bQuery').onclick = () => { S.dash.queried = true; toast('查询', '行业' + S.dash.ci.size + ' 职业' + S.dash.cj.size + ' 城市' + S.dash.cc.size); renderDash(); };
  updateChips();
  if (q.queried) {
    renderDash();
  } else {
    renderDashPreview();
  }
}

function renderDashPreview() {
  const industries = applyEdits('industries', DB.industries);
  const recent = industries.slice(0, 10);
  let h = '<div class="card"><div class="card-bd"><div class="sec-h">最近行业记录（共' + industries.length + '条）</div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>行业编号</th><th>行业门类</th><th>细分行业</th><th>风险</th><th>毛利率</th></tr></thead><tbody>';
  for (const r of recent) {
    h += '<tr><td>' + esc(r['行业编号']) + '</td><td>' + esc(r['行业门类']) + '</td><td>' + esc(r['细分行业']) + '</td><td>' + esc(normLv(r['风险层级']) || '—') + '</td><td>' + esc(r['毛利率区间'] || '—') + '</td></tr>';
  }
  h += '</tbody></table></div><p class="hint" style="margin-top:10px">以上为前10条行业记录预览。选择筛选条件后点击「查询数据」查看完整结果。</p></div></div>';
  $('#dashBody').innerHTML = h;
}


function updateChips() {
  const q = S.dash;
  const industries = applyEdits('industries', DB.industries);

  // 行业候选
  let indCandidates = [];
  if (q.industry.trim()) {
    const kw = q.industry.trim().toLowerCase();
    indCandidates = industries.filter(r =>
      r['行业编号'].toLowerCase().includes(kw) ||
      r['细分行业'].toLowerCase().includes(kw) ||
      r['行业门类'].toLowerCase().includes(kw) ||
      (r['职业标签串'] || '').toLowerCase().includes(kw)
    ).slice(0, 8);
  }

  // 行业提示词
  if (q.industry.trim() && !indCandidates.length) {
    $('#hInd').innerHTML = '未找到匹配行业，试试其他关键词如：建筑、餐饮、物流、IT';
  } else if (indCandidates.length) {
    $('#hInd').innerHTML = `命中 <b>${indCandidates.length}</b> 个行业，点击标签可多选`;
  } else {
    $('#hInd').innerHTML = '输入关键词后点选下方标签锁定行业（支持多选）';
  }

  $('#mInd').innerHTML = q.ci.size ? `已选 <b>${q.ci.size}</b> 个行业` : (indCandidates.length ? `命中 <b>${indCandidates.length}</b> 个行业` : '输入关键词搜索');
  $('#chInd').innerHTML = indCandidates.map(r => {
    const on = q.ci.has(r['行业编号']);
    return `<span class="chip${on ? ' on' : ''}" data-code="${esc(r['行业编号'])}">${esc(r['行业编号'])} ${esc(r['细分行业'])}</span>`;
  }).join('') || '<span class="hint">—</span>';
  $$('#chInd .chip').forEach(el => {
    el.onclick = () => {
      const code = el.getAttribute('data-code');
      if (q.ci.has(code)) { q.ci.delete(code); }
      else { q.ci.add(code); toast('已选行业', code + ' (共' + q.ci.size + '个)'); }
      updateChips();
    };
  });

  // 职业候选
  const selectedInds = q.ci.size ? industries.filter(r => q.ci.has(r['行业编号'])) : [];
  const jobPool = q.ci.size ? DB.jobs.filter(j => q.ci.has(j['行业编号'])) : [];
  let jobCandidates = [];
  if (q.job.trim() && jobPool.length) {
    const kw = q.job.trim().toLowerCase();
    jobCandidates = jobPool.filter(j => j['常见职位'].toLowerCase().includes(kw)).slice(0, 12);
  } else if (jobPool.length) {
    jobCandidates = jobPool.slice(0, 12);
  }

  $('#qJob').disabled = !q.ci.size;
  $('#mJob').innerHTML = q.ci.size
    ? `本行业 <b>${jobPool.length}</b> 个职位${q.cj.size ? ` · 已选 <b>${q.cj.size}</b>` : ''}`
    : '请先选定行业';
  $('#hJob').innerHTML = q.ci.size ? `共 ${jobPool.length} 个职位，点击标签可多选` : '先选择行业后可搜索职业';
  $('#chJob').innerHTML = jobCandidates.map(j => {
    const on = q.cj.has(j['常见职位']);
    return `<span class="chip${on ? ' on' : ''}" data-j="${esc(j['常见职位'])}">${esc(j['常见职位'])}</span>`;
  }).join('') || '<span class="hint">—</span>';
  $$('#chJob .chip').forEach(el => {
    el.onclick = () => {
      const jn = el.dataset.j;
      if (q.cj.has(jn)) q.cj.delete(jn); else q.cj.add(jn);
      updateChips();
    };
  });

  // 城市候选
  const cities = DB.cities;
  let cityCandidates = [];
  if (q.city.trim()) {
    const kw = q.city.trim().toLowerCase();
    cityCandidates = cities.filter(r =>
      r['城市名称'].toLowerCase().includes(kw) ||
      (r['定位标签'] || '').toLowerCase().includes(kw)
    );
  } else {
    cityCandidates = cities;
  }

  $('#mCity').innerHTML = q.cc.size ? `已选 <b>${q.cc.size}</b> 个城市` : `共 <b>${cities.length}</b> 个城市`;
  $('#hCity').innerHTML = '点击城市标签可多选，不选则默认全部';
  $('#chCity').innerHTML = cityCandidates.map(r => {
    const on = q.cc.has(r['城市名称']);
    return `<span class="chip${on ? ' on' : ''}" data-c="${esc(r['城市名称'])}" title="${esc(r['定位标签'] || '')}">${esc(r['城市名称'])}</span>`;
  }).join('');
  $$('#chCity .chip').forEach(el => {
    el.onclick = () => {
      const cn = el.dataset.c;
      if (q.cc.has(cn)) q.cc.delete(cn); else q.cc.add(cn);
      updateChips();
    };
  });
}

function renderDash() {
  const q = S.dash;
  const industries = applyEdits('industries', DB.industries);
  const jobs = applyEdits('jobs', DB.jobs);
  const modes = applyEdits('modes', DB.modes);
  const risks = applyEdits('city_risks', DB.city_risks);

  const selectedCodes = q.ci.size ? [...q.ci] : [];
  const indRecords = selectedCodes.length ? industries.filter(r => q.ci.has(r['行业编号'])) : [];
  const selectedJobs = q.cj.size ? [...q.cj] : [];
  const selectedCities = q.cc.size ? [...q.cc] : [];
  const allCities = DB.cities.map(c => c['城市名称']);

  // 状态栏
  const indLabel = indRecords.length ? indRecords.map(r => r['细分行业']).join('、') : '全部';
  const jobLabel = selectedJobs.length ? selectedJobs.join('、') : '全部';
  const cityLabel = selectedCities.length ? selectedCities.join('、') : '全部';
  $('#statusLine').innerHTML =
    `<span>行业：<b>${esc(indLabel)}</b><span class="sep">｜</span>` +
    `职业：<b>${esc(jobLabel)}</b><span class="sep">｜</span>` +
    `城市：<b>${esc(cityLabel)}</b></span>` +
    `<span class="act">
      <button class="btn sm" id="bReset2">重置全部</button>
      <button class="btn green sm" id="bQuery2">查询数据</button>
    </span>`;
  $('#bReset2').onclick = () => {
    S.dash = { industry: '', job: '', city: '', ci: new Set(), cj: new Set(), cc: new Set(), queried: false };
    go('dashboard');
  };
  $('#bQuery2').onclick = () => {
    S.dash.queried = true;
    toast('查询', '行业' + S.dash.ci.size + ' 职业' + S.dash.cj.size + ' 城市' + S.dash.cc.size);
    renderDash();
  };

  let html = '';

  // 识别编号
  if (indRecords.length === 1) {
    const ind = indRecords[0];
    const jobCount = jobs.filter(j => j['行业编号'] === ind['行业编号']).length;
    const modeCount = modes.filter(m => m['行业编号'] === ind['行业编号']).length;
    html += `<div class="idbox fade-in">
      <div><div class="k">识别编号</div><div class="v code">${esc(ind['行业编号'])}</div></div>
      <div><div class="k">行业名称</div><div class="v">${esc(ind['细分行业'])}</div></div>
      <div><div class="k">行业门类</div><div class="v">${esc(ind['行业门类'])}</div></div>
      <div><div class="k">职业 / 模式 / 城市</div><div class="v">${jobCount} / ${modeCount} / ${allCities.length}</div></div>
    </div>`;
  } else if (indRecords.length > 1) {
    html += `<div class="idbox fade-in">
      <div><div class="k">已选行业</div><div class="v">${indRecords.length} 个</div></div>
      <div><div class="k">行业列表</div><div class="v" style="font-size:13px;font-weight:400">${indRecords.map(r => esc(r['行业编号'] + ' ' + r['细分行业'])).join('、')}</div></div>
    </div>`;
  }

  // 01 行业档案
  if (indRecords.length) {
    html += sec01(indRecords, industries);
  }

  // 02 经营模式
  if (indRecords.length || selectedCodes.length) {
    const modeRecords = selectedCodes.length ? modes.filter(m => q.ci.has(m['行业编号'])) : [];
    html += sec02(modeRecords);
  }

  // 03 前景利润淡旺季
  if (indRecords.length) {
    html += sec03(indRecords);
  }

  // 04 在职客户岗位核实
  if (selectedCodes.length) {
    let jobRecords;
    if (selectedJobs.length) {
      jobRecords = jobs.filter(j => q.ci.has(j['行业编号']) && q.cj.has(j['常见职位']));
    } else {
      jobRecords = jobs.filter(j => q.ci.has(j['行业编号']));
    }
    html += sec04(jobRecords, selectedJobs);

    // 06 薪资趋势（在审核信息下面）
    if (selectedJobs.length) {
      html += sec06(selectedCodes.length === 1 ? selectedCodes[0] : '', selectedJobs, selectedCities);
    } else if (jobRecords.length) {
      html += sec06(selectedCodes.length === 1 ? selectedCodes[0] : '', jobRecords.slice(0, 3).map(j => j['常见职位']), selectedCities);
    }
  }

  // 05 城市风险分级
  if (selectedCodes.length || selectedCities.length) {
    let riskRecords;
    if (selectedCodes.length && selectedCities.length) {
      riskRecords = risks.filter(r => q.ci.has(r['行业编号']) && q.cc.has(r['城市']));
    } else if (selectedCodes.length) {
      riskRecords = risks.filter(r => q.ci.has(r['行业编号']));
    } else {
      riskRecords = risks.filter(r => q.cc.has(r['城市']));
    }
    html += sec05(riskRecords, selectedCodes.length > 0, selectedCities);
  }

  if (!html) {
    html = '<div class="empty"><span class="big">📋</span>请至少选择一个行业或城市后查询数据</div>';
  }

  $('#dashBody').innerHTML = html;
  bindGroupToggles($('#dashBody'));
}

function cardHead(no, title, sub) {
  const icons = {
    'A':'📊','I':'💎','J':'📅','M':'📜','T':'⚖',
    'G':'🔥','N':'🔀','O':'🔍','U':'🎯',
    'C':'🏙','P':'💰',
    'F':'💵','B':'⚠','D':'🗺','E':'🏆','R':'🎯',
    'K':'📈','L':'💵','S':'⚡',
    '01':'📋','02':'👥','03':'🌍','04':'📐',
  };
  const ico = icons[no] || '📈';
  return `<div class="card-hd"><h3><span class="no">${no}</span><span class="card-ico">${ico}</span>${esc(title)}</h3>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;
}

function sec01(inds, allInds) {
  let body = '';
  for (const ind of inds) {
    const k = ind['行业编号'];
    body += `<div class="grp">
      <div class="grp-hd"><span class="idx">◆</span>${esc(ind['细分行业'])}<span class="rt">${esc(ind['行业门类'])} · ${esc(k)}</span></div>
      <div class="grp-bd"><table class="kv">${F.industries_01.map(f => {
        const v = ind[f] || '';
        return `<tr><th>${esc(lb(f))}</th><td>${v ? nl2br(v) : '<span style="color:#cbd5e1">—</span>'}</td></tr>`;
      }).join('')}</table></div></div>`;
  }
  return `<div class="card fade-in">${cardHead('01', '行业档案', `${inds.length} 个行业`)}
    <div class="card-bd"><div class="grp-list">${body}</div></div></div>`;
}

function sec02(modes) {
  if (!modes.length) return '';
  const body = `<div class="grp-list">${modes.map((m, i) => {
    return `<div class="grp">
      <div class="grp-hd"><span class="idx">◆</span>${esc(m['细分模式'])}
        <span class="rt">第 ${i + 1} / ${modes.length} 条</span><span class="toggle">▾</span></div>
      <div class="grp-bd"><table class="kv">${F.modes_02.map(f => {
        const v = m[f] || '';
        return `<tr><th>${esc(lb(f))}</th><td>${v ? nl2br(v) : '<span style="color:#cbd5e1">—</span>'}</td></tr>`;
      }).join('')}</table></div></div>`;
  }).join('')}</div>`;
  return `<div class="card fade-in">${cardHead('02', '经营模式', `共 ${modes.length} 条`)}
    <div class="card-bd">${body}</div></div>`;
}

function sec03(inds) {
  let body = '';
  for (const ind of inds) {
    body += `<div class="grp">
      <div class="grp-hd"><span class="idx">◆</span>${esc(ind['细分行业'])}<span class="toggle">▾</span></div>
      <div class="grp-bd"><table class="kv">
        <tr><th>${esc(lb('前景趋势判断'))}</th><td colspan="3">${ind['前景趋势判断'] ? nl2br(ind['前景趋势判断']) : '<span style="color:#cbd5e1">—</span>'}</td></tr>
        <tr><th>${esc(lb('毛利率区间'))}</th><td style="width:40%">${ind['毛利率区间'] ? nl2br(ind['毛利率区间']) : '<span style="color:#cbd5e1">—</span>'}</td>
          <th style="width:100px">${esc(lb('净利率区间'))}</th><td>${ind['净利率区间'] ? nl2br(ind['净利率区间']) : '<span style="color:#cbd5e1">—</span>'}</td></tr>
        <tr><th>${esc(lb('旺季月份'))}</th><td>${ind['旺季月份'] ? nl2br(ind['旺季月份']) : '<span style="color:#cbd5e1">—</span>'}</td>
          <th>${esc(lb('淡季月份'))}</th><td>${ind['淡季月份'] ? nl2br(ind['淡季月份']) : '<span style="color:#cbd5e1">—</span>'}</td></tr>
        <tr><th>${esc(lb('季节性资金缺口高峰'))}</th><td colspan="3">${ind['季节性资金缺口高峰'] ? nl2br(ind['季节性资金缺口高峰']) : '<span style="color:#cbd5e1">—</span>'}</td></tr>
        <tr><th>${esc(lb('主要经营风险'))}</th><td colspan="3">${ind['主要经营风险'] ? nl2br(ind['主要经营风险']) : '<span style="color:#cbd5e1">—</span>'}</td></tr>
        <tr><th>${esc(lb('政策与外部驱动'))}</th><td colspan="3">${ind['政策与外部驱动'] ? nl2br(ind['政策与外部驱动']) : '<span style="color:#cbd5e1">—</span>'}</td></tr>
      </table></div></div>`;
  }
  return `<div class="card fade-in">${cardHead('03', '前景、利润、淡旺季', '含毛利率/净利率/旺淡季')}
    <div class="card-bd"><div class="grp-list">${body}</div></div></div>`;
}

function sec04(jobs, selectedJobs) {
  if (!jobs.length) {
    return `<div class="card fade-in">${cardHead('04', '在职客户岗位核实', '无匹配职位')}
      <div class="card-bd"><div class="empty"><span class="big">👥</span>未选中职业或该行业无匹配职位</div></div></div>`;
  }
  const body = `<div class="grp-list">${jobs.map((j, i) => {
    return `<div class="grp">
      <div class="grp-hd"><span class="idx">◆</span>${esc(j['常见职位'])}
        <span class="rt">第 ${i + 1} / ${jobs.length} 条</span><span class="toggle">▾</span></div>
      <div class="grp-bd"><table class="kv">${F.jobs_04.map(f => {
        const v = j[f] || '';
        return `<tr><th>${esc(lb(f))}</th><td>${v ? nl2br(v) : '<span style="color:#cbd5e1">—</span>'}</td></tr>`;
      }).join('')}</table></div></div>`;
  }).join('')}</div>`;
  return `<div class="card fade-in">${cardHead('04', '在职客户岗位核实', `显示 ${jobs.length} 个职位`)}
    <div class="card-bd">${body}</div></div>`;
}

function sec05(rows, hasInd, selectedCities) {
  if (!rows.length) {
    return `<div class="card fade-in">${cardHead('05', '城市风险分级（A 低 → D 高）', '无匹配')}
      <div class="card-bd"><div class="empty"><span class="big">🏙</span>无匹配城市风险数据</div></div></div>`;
  }
  const body = `<div class="tbl-wrap"><table class="risk-tbl">
    <thead><tr><th>城市</th><th>风险层级</th><th>定级依据与尽调要点</th></tr></thead>
    <tbody>${rows.map(r => `<tr>
      <td class="city">${esc(r['城市'])}</td>
      <td class="lvcell">${hasInd ? `<span class="lv ${lvClass(r['风险层级'])}">${esc(normLv(r['风险层级']) || '—')}</span>` : '<span style="color:#cbd5e1">—</span>'}</td>
      <td class="basis">${hasInd ? nl2br(r['依据与尽调要点']) : '<span style="color:#cbd5e1">请先选定行业</span>'}</td>
    </tr>`).join('')}</tbody></table></div>`;
  return `<div class="card fade-in">${cardHead('05', '城市风险分级（A 低 → D 高）', `${rows.length} 条记录`)}
    <div class="card-bd">${body}
      <div class="legend">
        <span><i style="background:var(--lv-a-bg);border:1px solid var(--lv-a)"></i>A 低风险</span>
        <span><i style="background:var(--lv-b-bg);border:1px solid var(--lv-b)"></i>B 中低</span>
        <span><i style="background:var(--lv-c-bg);border:1px solid var(--lv-c)"></i>C 中等</span>
        <span><i style="background:var(--lv-d-bg);border:1px solid var(--lv-d)"></i>D 高风险</span>
      </div>
    </div></div>`;
}

// 06 薪资趋势（支持城市维度 + 购买力）
function sec06(indCode, jobNames, selectedCities) {
  if (!jobNames || !jobNames.length) return '';
  const cities = selectedCities && selectedCities.length ? selectedCities : ['重庆'];
  const cf = DB.city_factors || {};

  const cards = jobNames.map(jn => {
    const key = indCode ? `${indCode}|${jn}` : Object.keys(DB.salary).find(k => k.endsWith('|' + jn));
    const sd = key ? DB.salary[key] : null;
    if (!sd) return '';

    const trend = sd.trend || {};
    const years = Object.keys(trend).sort();
    if (!years.length) return '';
    const maxVal = Math.max(...years.map(y => trend[y].max * Math.max(...cities.map(c => cf[c] || 1))));

    // 城市薪资对比表
    const cityRows = cities.map(cn => {
      const f = cf[cn] || 1;
      const adj = Math.round(sd.monthly_median * f);
      const adjMin = Math.round(sd.monthly_min * f);
      const adjMax = Math.round(sd.monthly_max * f);
      const pp = Math.round(adj / f);
      const ppLevel = pp >= sd.monthly_median * 1.1 ? 'high' : pp <= sd.monthly_median * 0.9 ? 'low' : 'mid';
      return `<tr>
        <td class="city">${esc(cn)}</td>
        <td>${(adjMin/1000).toFixed(1)}k - ${(adjMax/1000).toFixed(1)}k</td>
        <td><b>${(adj/1000).toFixed(1)}k</b></td>
        <td>${(pp/1000).toFixed(1)}k <span class="pp-tag ${ppLevel}">${ppLevel === 'high' ? '↑高于基准' : ppLevel === 'low' ? '↓低于基准' : '≈持平'}</span></td>
        <td>${(adj*12/10000).toFixed(1)}w</td>
      </tr>`;
    }).join('');

    // 城市对比柱状图
    const cityBars = cities.map(cn => {
      const f = cf[cn] || 1;
      const adj = Math.round(sd.monthly_median * f);
      const h = (adj / maxVal * 100).toFixed(1);
      const pp = Math.round(adj / f);
      const ppH = (pp / maxVal * 100).toFixed(1);
      return `<div class="city-bar-group">
        <div class="city-bar-pair">
          <div class="city-bar" title="${esc(cn)}名义薪资: ${(adj/1000).toFixed(1)}k">
            <div class="bar-val">${(adj/1000).toFixed(1)}k</div>
            <div class="bar-fill" style="height:${h}%;background:linear-gradient(180deg,#60a5fa,#2563eb)"></div>
          </div>
          <div class="city-bar" title="${esc(cn)}购买力等值: ${(pp/1000).toFixed(1)}k">
            <div class="bar-val" style="color:var(--c-accent)">${(pp/1000).toFixed(1)}k</div>
            <div class="bar-fill" style="height:${ppH}%;background:linear-gradient(180deg,#34d399,#059669)"></div>
          </div>
        </div>
        <div class="bar-lbl">${esc(cn)}</div>
      </div>`;
    }).join('');

    // 年度趋势柱状图（使用基准薪资）
    const bars = years.map(y => {
      const d = trend[y];
      const h = (d.median / maxVal * 100).toFixed(1);
      const isLatest = y === years[years.length - 1];
      return `<div class="salary-bar">
        <div class="bar-val">${(d.median / 1000).toFixed(1)}k</div>
        <div class="bar-fill" style="height:${h}%;${isLatest ? 'background:linear-gradient(180deg,#60a5fa,#2563eb)' : ''}"></div>
        <div class="bar-lbl">${y}</div>
      </div>`;
    }).join('');

    const firstYear = trend[years[0]];
    const lastYear = trend[years[years.length - 1]];
    const growth = firstYear && lastYear ? ((lastYear.median - firstYear.median) / firstYear.median * 100).toFixed(1) : 0;

    const demandTag = sd.demand === '高' ? 'hot' : sd.demand === '中' ? 'warm' : 'cool';
    const demandText = sd.demand === '高' ? '需求旺盛' : sd.demand === '中' ? '需求稳定' : '需求一般';

    const baseMedian = (sd.monthly_median/1000).toFixed(1);

    return `<div class="salary-card fade-in">
      <div class="card-hd"><h3><span class="no">06</span>${esc(jn)} · 薪资趋势分析</h3><div class="sub">2020-2026 · 基准薪资 ${baseMedian}k</div></div>
      <div class="salary-grid">
        <div class="salary-stat"><div class="sl">基准月薪</div><div class="sv">${baseMedian}k</div></div>
        <div class="salary-stat"><div class="sl">月薪范围</div><div class="sv">${(sd.monthly_min/1000).toFixed(1)}k<small> - ${(sd.monthly_max/1000).toFixed(1)}k</small></div></div>
        <div class="salary-stat"><div class="sl">年薪中位</div><div class="sv">${(sd.annual_median/10000).toFixed(1)}w</div></div>
        <div class="salary-stat"><div class="sl">7年增长</div><div class="sv">${growth > 0 ? '+' : ''}${growth}%</div><div class="delta ${growth > 0 ? 'up' : 'down'}">${growth > 0 ? '↑' : '↓'} ${Math.abs(growth)}%</div></div>
      </div>

      ${cities.length > 1 || (cities.length === 1 && cities[0] !== '重庆') ? `
      <div class="salary-city-chart">
        <div class="chart-title">🏙 各城市薪资 vs 购买力对比</div>
        <div class="city-bars-legend">
          <span><i style="background:#2563eb"></i>名义月薪（含城市系数调整）</span>
          <span><i style="background:#059669"></i>购买力等值（扣除生活成本后）</span>
        </div>
        <div class="salary-bars city-mode">${cityBars}</div>
      </div>
      <div class="salary-city-tbl">
        <table class="tbl compact">
          <thead><tr><th>城市</th><th>月薪范围</th><th>月薪中位</th><th>购买力等值</th><th>年薪</th></tr></thead>
          <tbody>${cityRows}</tbody>
        </table>
      </div>` : ''}

      <div class="salary-chart">
        <div class="chart-title">📊 年度薪资趋势（基准月薪中位数）</div>
        <div class="salary-bars">${bars}</div>
      </div>
      <div class="salary-demand">
        <span class="dl">市场需求：</span>
        <span class="tag ${demandTag}">${demandText}</span>
        <span class="dl" style="margin-left:12px">年均增长率：</span>
        <span class="tag blue">${esc(sd.growth_rate)}</span>
        <span class="dl" style="margin-left:auto;font-size:11px;color:var(--c-tx-3)">基准薪资基于行业门类模型估算，城市薪资=基准×城市系数，购买力=名义薪资÷城市系数</span>
      </div>
    </div>`;
  }).join('');

  return cards || '';
}

function bindGroupToggles(root) {
  $$('.grp-hd', root).forEach(h => {
    h.onclick = (e) => {
      const grp = h.closest('.grp');
      if (grp) {
        grp.classList.toggle('collapsed');
        const toggle = h.querySelector('.toggle');
        if (toggle) toggle.textContent = grp.classList.contains('collapsed') ? '▸' : '▾';
      }
    };
  });

}


// ================================================================== 统计分析 — 数据准备
function getAnalyticsCtx() {
  const inds = applyEdits('industries', DB.industries);
  const jobs = applyEdits('jobs', DB.jobs);
  const modes = applyEdits('modes', DB.modes);
  const risks = applyEdits('city_risks', DB.city_risks);
  const cities = DB.cities;

  const t = {
    行业: inds.length, 门类: new Set(inds.map(r => r['行业门类'])).size,
    职业: jobs.length, 经营模式: modes.length,
    城市: cities.length, 城市风险记录: risks.length,
  };

  const catMap = {};
  for (const ind of inds) {
    const cat = ind['行业门类'] || '其他';
    if (!catMap[cat]) catMap[cat] = { count: 0, codes: [] };
    catMap[cat].count++;
    catMap[cat].codes.push(ind['行业编号']);
  }
  const cats = Object.entries(catMap).sort((a, b) => b[1].count - a[1].count);
  const catMax = cats.length ? cats[0][1].count : 1;

  const lvMap = {};
  for (const r of risks) {
    const lv = normLv(r['风险层级']) || 'C';
    lvMap[lv] = (lvMap[lv] || 0) + 1;
  }
  const lvTotal = Object.values(lvMap).reduce((a, b) => a + b, 0) || 1;

  const cityRiskMap = {};
  for (const r of risks) {
    const cn = r['城市'];
    if (!cityRiskMap[cn]) cityRiskMap[cn] = { total: 0, high: 0, mid: 0, low: 0, aLow: 0, bLow: 0 };
    cityRiskMap[cn].total++;
    const lv = normLv(r['风险层级']);
    if (lv === 'D') cityRiskMap[cn].high++;
    else if (lv === 'C') cityRiskMap[cn].mid++;
    else if (lv === 'B') { cityRiskMap[cn].bLow++; cityRiskMap[cn].low++; }
    else { cityRiskMap[cn].aLow++; cityRiskMap[cn].low++; }
  }
  const cityRows = Object.entries(cityRiskMap).sort((a, b) => b[1].high - a[1].high);

  const indRisk = [];
  const lvScore = { 'A': 1, 'B': 2, 'C': 3, 'D': 4 };
  for (const ind of inds) {
    const code = ind['行业编号'];
    const indRisks = risks.filter(r => r['行业编号'] === code);
    if (!indRisks.length) continue;
    let sum = 0, maxCity = '', maxScore = 0;
    for (const r of indRisks) {
      const lv = normLv(r['风险层级']);
      const sc = lvScore[lv] || 3;
      sum += sc;
      if (sc > maxScore) { maxScore = sc; maxCity = r['城市']; }
    }
    indRisk.push({ ...ind, 风险指数: +(sum / indRisks.length).toFixed(2), 最高风险城市: maxCity });
  }
  indRisk.sort((a, b) => b.风险指数 - a.风险指数);
  const topRisk = indRisk.slice(0, 20);
  const bestRisk = indRisk.slice(-15).reverse();

  const salaryKeys = Object.keys(DB.salary);
  const salaryStats = salaryKeys.map(k => DB.salary[k]).filter(s => s);
  const salaryBins = { '3k以下': 0, '3-5k': 0, '5-8k': 0, '8-12k': 0, '12-20k': 0, '20k以上': 0 };
  for (const s of salaryStats) {
    const m = s.monthly_median;
    if (m < 3000) salaryBins['3k以下']++;
    else if (m < 5000) salaryBins['3-5k']++;
    else if (m < 8000) salaryBins['5-8k']++;
    else if (m < 12000) salaryBins['8-12k']++;
    else if (m < 20000) salaryBins['12-20k']++;
    else salaryBins['20k以上']++;
  }
  const sMax = Math.max(1, ...Object.values(salaryBins));

  const demandMap = { '高': 0, '中': 0, '低': 0 };
  for (const s of salaryStats) {
    demandMap[s.demand] = (demandMap[s.demand] || 0) + 1;
  }

  return { inds, jobs, modes, risks, cities, t, cats, catMax, lvMap, lvTotal, cityRiskMap, cityRows, indRisk, topRisk, bestRisk, salaryStats, salaryBins, sMax, demandMap };
}

// ================================================================== 行业分析
function pageAnaIndustry(c) {
  const ctx = getAnalyticsCtx();
  const { inds, t, cats, catMax } = ctx;
  c.innerHTML = `
  <div class="stat-grid fade-in">
    <div class="stat"><div class="n">${t.行业}</div><div class="l">细分行业</div></div>
    <div class="stat g"><div class="n">${t.门类}</div><div class="l">行业门类</div></div>
    <div class="stat"><div class="n">${t.职业}</div><div class="l">岗位核实明细</div></div>
    <div class="stat g"><div class="n">${t.经营模式}</div><div class="l">经营模式条目</div></div>
    <div class="stat o"><div class="n">${t.城市}</div><div class="l">覆盖城市</div></div>
    <div class="stat r"><div class="n">${t.城市风险记录}</div><div class="l">行业×城市 分级记录</div></div>
  </div>
  <div class="ana-grid">
    <div class="card fade-in">${cardHead('A', '行业门类分布', `${t.行业} 个细分行业 / ${t.门类} 个门类`)}
      <div class="card-bd"><div class="bars">
        ${cats.map(([n, v]) => `<div class="bar-row">
          <div class="bl" title="${esc(v.codes.join('、'))}">${esc(n)}</div>
          <div class="bt"><div class="bf" style="width:${(v.count / catMax * 100).toFixed(1)}%"></div></div>
          <div class="bv">${v.count}</div></div>`).join('')}
      </div></div></div>
    <div class="card fade-in">${cardHead('I', '毛利率 vs 净利率 散点图', '行业利润率分布')}
      <div class="card-bd"><div class="scatter-plot" id="scatterPP"></div>
        <div class="scatter-legend">
          <span><i style="background:#059669"></i>高利润</span>
          <span><i style="background:#d97706"></i>中等利润</span>
          <span><i style="background:#dc2626"></i>低利润或亏损</span>
        </div></div></div>
    <div class="card fade-in">${cardHead('J', '旺淡季日历热力图', '12个月 × 行业门类')}
      <div class="card-bd"><div class="cal-heat" id="calHeat"></div></div></div>
    <div class="card fade-in">${cardHead('M', '政策驱动词频分析', '政策关键词统计')}
      <div class="card-bd"><div class="bars" id="policyFreq"></div></div></div>
    <div class="card fade-in">${cardHead('T', '监管强度地图', '各行业必备证照数量')}
      <div class="card-bd"><div class="bars" id="licenseRank"></div></div></div>
  </div>`;

  // I 毛利率 vs 净利率散点图
  (function() {
    const parsePct = (s) => { const m = String(s || '').match(/(\d+(?:\.\d+)?)/g); return (!m || !m.length) ? null : m.map(Number); };
    const pts = inds.map(ind => {
      const gm = parsePct(ind['毛利率区间']); const gn = parsePct(ind['净利率区间']);
      if (!gm || !gn) return null;
      return { x: gm[0], y: gn[0], name: ind['细分行业'], code: ind['行业编号'], gm, gn };
    }).filter(Boolean);
    if (!pts.length) { $('#scatterPP').innerHTML = '<p class="hint">暂无利润率数据</p>'; return; }
    const maxX = Math.max(...pts.map(p => p.x)) || 1, maxY = Math.max(...pts.map(p => p.y)) || 1;
    const dots = pts.map(p => {
      const color = p.x >= 20 || p.y >= 10 ? '#059669' : p.x >= 10 ? '#d97706' : '#dc2626';
      return `<div class="sdot" style="left:${(p.x/maxX*100).toFixed(1)}%;bottom:${(p.y/maxY*100).toFixed(1)}%;background:${color}" title="${esc(p.name)}：毛${p.gm[0]}%~${p.gm[1]||p.gm[0]}% 净${p.gn[0]}%~${p.gn[1]||p.gn[0]}%"></div>`;
    }).join('');
    $('#scatterPP').innerHTML = `<div class="scatter-axis-y">净利率%</div><div class="scatter-area">${dots}</div><div class="scatter-axis-x">毛利率% →</div>`;
  })();

  // J 旺淡季日历热力图
  (function() {
    const months = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
    const catMonths = {};
    for (const ind of inds) {
      const cat = ind['行业门类'] || '其他';
      if (!catMonths[cat]) catMonths[cat] = new Array(12).fill(0);
      const peak = String(ind['旺季月份'] || ''); const m = peak.match(/(\d+)/g);
      if (m) for (const mo of m) { const mi = parseInt(mo)-1; if (mi>=0 && mi<12) catMonths[cat][mi]++; }
    }
    const cats2 = Object.entries(catMonths).sort((a,b) => b[1].reduce((x,y)=>x+y,0) - a[1].reduce((x,y)=>x+y,0));
    const maxM = Math.max(1, ...cats2.map(x => Math.max(...x[1])));
    let h = '<table class="cal-tbl"><thead><tr><th>门类</th>' + months.map(m => `<th>${m}</th>`).join('') + '</tr></thead><tbody>';
    for (const [cat, arr] of cats2) {
      h += `<tr><td class="rowh">${esc(cat)}</td>` + arr.map(v => {
        const op = v === 0 ? '0' : (v / maxM * 0.9 + 0.1).toFixed(2);
        return `<td class="cal-c" style="background:rgba(37,99,235,${op})" title="${esc(cat)}: ${v}个行业">${v||''}</td>`;
      }).join('') + '</tr>';
    }
    h += '</tbody></table>';
    $('#calHeat').innerHTML = h;
  })();

  // M 政策驱动词频分析
  (function() {
    const kw = ['专项债','补贴','税收优惠','环保','数字化转型','新能源','乡村振兴','城市更新','保障性住房','技改','监管','审批','牌照','碳达峰','以旧换新','减税降费'];
    const freq = {};
    for (const ind of inds) { const txt = String(ind['政策与外部驱动'] || ''); for (const k of kw) { if (txt.includes(k)) freq[k] = (freq[k]||0) + 1; } }
    const sorted = Object.entries(freq).sort((a,b) => b[1]-a[1]);
    const mx = Math.max(1, ...sorted.map(x => x[1]));
    $('#policyFreq').innerHTML = sorted.map(([n,v]) => `<div class="bar-row green"><div class="bl">${esc(n)}</div><div class="bt"><div class="bf" style="width:${(v/mx*100).toFixed(1)}%"></div></div><div class="bv">${v} <small style="color:#94a3b8;font-weight:400">${(v/inds.length*100).toFixed(0)}%</small></div></div>`).join('');
  })();

  // T 监管强度地图
  (function() {
    const scored = inds.map(ind => {
      const lic = String(ind['必备证照资质'] || '');
      const count = (lic.match(/[、，]/g) || []).length + 1;
      const hasCert = /证|许可|资质|执照/.test(lic);
      return { name: ind['细分行业'], code: ind['行业编号'], count: hasCert ? count : 0 };
    }).filter(x => x.count > 0).sort((a,b) => b.count - a.count);
    const top = scored.slice(0, 25);
    const mx = Math.max(1, ...top.map(x => x.count));
    $('#licenseRank').innerHTML = `<div class="bars">${top.map(x => `<div class="bar-row ${x.count >= 5 ? 'red' : x.count >= 3 ? 'orange' : 'gold'}"><div class="bl">${esc(x.code)} ${esc(x.name)}</div><div class="bt"><div class="bf" style="width:${(x.count/mx*100).toFixed(1)}%"></div></div><div class="bv">${x.count}项</div></div>`).join('')}</div>`;
  })();
}

// ================================================================== 职业分析
function pageAnaJob(c) {
  const ctx = getAnalyticsCtx();
  const { inds, jobs, salaryStats, demandMap } = ctx;
  c.innerHTML = `
  <div class="ana-grid">
    <div class="card fade-in">${cardHead('G', '职业市场需求热度', '高/中/低三档需求分布')}
      <div class="card-bd"><div class="bars">
        ${Object.entries(demandMap).map(([n, v]) => `<div class="bar-row ${n === '高' ? 'red' : n === '中' ? 'gold' : 'green'}">
          <div class="bl">${n === '高' ? '需求旺盛' : n === '中' ? '需求稳定' : '需求一般'}</div>
          <div class="bt"><div class="bf" style="width:${(v / Math.max(1, salaryStats.length) * 100).toFixed(1)}%"></div></div>
          <div class="bv">${v} <small style="color:#94a3b8;font-weight:400">${(v / Math.max(1, salaryStats.length) * 100).toFixed(1)}%</small></div></div>`).join('')}
      </div></div></div>
    <div class="card fade-in">${cardHead('N', '职业交叉行业薪资矩阵', '同一职位在不同行业的薪资对比')}
      <div class="card-bd"><div class="tbl-wrap" id="crossJob"></div></div></div>
    <div class="card fade-in">${cardHead('O', '职业审核难度评估', '基于证据可查性和破绽数量评分')}
      <div class="card-bd"><div id="auditDiff"></div></div></div>
    <div class="card fade-in">${cardHead('U', '职业群组聚类', '按需求等级分组 · 薪资范围一目了然')}
      <div class="card-bd"><div id="jobCluster"></div>
        <div class="cluster-legend">
          <span><i style="background:#dc2626"></i>高需求</span>
          <span><i style="background:#059669"></i>中需求</span>
          <span><small style="color:#94a3b8">条形=薪资范围（最低~最高） · 圆点=中位数</small></span>
        </div></div></div>
  </div>`;

  // N 职业交叉行业薪资矩阵
  (function() {
    const jobIndMap = {};
    for (const j of jobs) {
      const jn = j['常见职位'];
      if (!jobIndMap[jn]) jobIndMap[jn] = [];
      const sk = Object.keys(DB.salary).find(k => k.endsWith('|' + jn));
      const sd = sk ? DB.salary[sk] : null;
      jobIndMap[jn].push({ code: j['行业编号'], industry: inds.find(i => i['行业编号']===j['行业编号'])?['细分行业']:j['行业编号'], salary: sd });
    }
    const crossJobs = Object.entries(jobIndMap).filter(([k,v]) => v.length > 1).sort((a,b) => b[1].length-a[1].length).slice(0, 15);
    if (!crossJobs.length) { $('#crossJob').innerHTML = '<p class="hint">暂无跨行业职业数据</p>'; return; }
    let h = '<table class="tbl compact"><thead><tr><th>职位</th><th>出现行业数</th><th>基准月薪范围</th><th>薪资差异</th></tr></thead><tbody>';
    for (const [jn, arr] of crossJobs) {
      const sals = arr.map(x => x.salary).filter(Boolean);
      if (!sals.length) continue;
      const mins = Math.min(...sals.map(s => s.monthly_median));
      const maxs = Math.max(...sals.map(s => s.monthly_median));
      const diff = maxs - mins;
      const diffPct = mins > 0 ? (diff/mins*100).toFixed(0) : 0;
      h += `<tr><td><b>${esc(jn)}</b></td><td>${arr.length}</td><td>${(mins/1000).toFixed(1)}k - ${(maxs/1000).toFixed(1)}k</td><td><span class="tag ${diffPct > 30 ? 'red' : diffPct > 15 ? 'gold' : 'green'}">+${diffPct}%</span></td></tr>`;
    }
    h += '</tbody></table>';
    $('#crossJob').innerHTML = h;
  })();

  // O 职业审核难度评估
  (function() {
    const indMap = new Map(inds.map(i => [i['行业编号'], i]));
    const scored = jobs.map(j => {
      const evidence = String(j['能查到哪些证据'] || '');
      const flaws = String(j['没干过的破绽'] || '');
      const eCount = (evidence.match(/[、，；,;]/g) || []).length + 1;
      const fCount = (flaws.match(/[、，；,;]/g) || []).length + 1;
      const score = Math.round(eCount * 10 + fCount * 8);
      const ind = indMap.get(j['行业编号']);
      const catName = ind ? ind['行业门类'] : j['行业编号'];
      return { jn: j['常见职位'], code: j['行业编号'], cat: catName, score, eCount, fCount, evidence, flaws };
    }).sort((a,b) => b.score - a.score);
    const seen = new Set(), unique = [];
    for (const s of scored) { if (seen.has(s.jn)) continue; seen.add(s.jn); unique.push(s); }
    const top = unique.slice(0, 20);
    const mx = Math.max(1, ...top.map(x => x.score));
    $('#auditDiff').innerHTML = `<div class="bars">${top.map(x => `<div class="bar-row ${x.score >= 40 ? 'green' : x.score >= 25 ? 'gold' : 'red'}"><div class="bl" title="${esc(x.cat)}">${esc(x.jn)}<small style="display:block;color:#94a3b8;font-size:10px;font-weight:400">${esc(x.cat)}</small></div><div class="bt"><div class="bf" style="width:${(x.score/mx*100).toFixed(1)}%"></div></div><div class="bv">${x.score}分 <small style="color:#94a3b8;font-weight:400">证据${x.eCount}·破绽${x.fCount}</small></div></div>`).join('')}</div>`;
  })();

  // U 职业群组聚类 - 双视图：合并视图 + 行业展开视图
  (function() {
    // 1. 准备原始数据（按行业展开）
    const allJobs = [];
    for (const [k, s] of Object.entries(DB.salary)) {
      if (!s || !s.monthly_median) continue;
      const name = k.split('|')[1] || k;
      const code = k.split('|')[0] || '';
      const ind = DB.industries ? DB.industries.find(i => i['行业编号'] === code) : null;
      const cat = ind ? ind['行业门类'] : code;
      allJobs.push({
        name, code, cat,
        min: s.monthly_min || s.monthly_median * 0.75,
        median: s.monthly_median,
        max: s.monthly_max || s.monthly_median * 1.35,
        demand: s.demand || '中'
      });
    }
    if (!allJobs.length) { $('#jobCluster').innerHTML = '<p class="hint">暂无数据</p>'; return; }

    // 2. 按职位名合并数据
    const jobMap = {};
    for (const j of allJobs) {
      if (!jobMap[j.name]) {
        jobMap[j.name] = {
          name: j.name, min: j.min, max: j.max,
          medians: [], items: [], demand: j.demand
        };
      }
      const m = jobMap[j.name];
      if (j.min < m.min) m.min = j.min;
      if (j.max > m.max) m.max = j.max;
      m.medians.push(j.median);
      m.items.push(j);
      if (j.demand === '高') m.demand = '高';
    }
    const merged = Object.values(jobMap).map(j => ({
      ...j,
      median: Math.round(j.medians.reduce((a,b) => a+b, 0) / j.medians.length),
      indCount: j.items.length,
    }));

    const demandOrder = ['高', '中', '低'];
    const demandColors = { '高': '#dc2626', '中': '#059669', '低': '#64748b' };

    // 3. 渲染函数：合并视图
    function renderMerged() {
      const groups = { '高': [], '中': [], '低': [] };
      for (const j of merged) { (groups[j.demand] || (groups[j.demand] = groups['中'])).push(j); }
      const allMax = Math.max(...merged.map(j => j.max), 1);
      let h = '';
      for (const d of demandOrder) {
        const jobs = groups[d] || [];
        if (!jobs.length) continue;
        jobs.sort((a, b) => b.median - a.median);
        const top = jobs.slice(0, 12);
        h += `<div class="cluster-group"><div class="cluster-label" style="border-left-color:${demandColors[d]}">${d}需求 <small style="color:#94a3b8;font-weight:400">${jobs.length} 个职位（合并去重）· 显示前${top.length}</small></div><div class="cluster-jobs">`;
        for (const j of top) {
          const leftPct = (j.min / allMax * 100).toFixed(1);
          const widthPct = Math.max(2, ((j.max - j.min) / allMax * 100)).toFixed(1);
          const medPct = (j.median / allMax * 100).toFixed(1);
          const cats = [...new Set(j.items.map(i => i.cat))];
          const catList = cats.slice(0, 2).join('、') + (cats.length > 2 ? '…' : '');
          const title = `${j.name}\n薪资范围: ${j.min}~${j.max}\n中位数: ${j.median}\n覆盖行业: ${j.indCount}个 (${catList})\n需求: ${j.demand}`;
          h += `<div class="cluster-job" title="${esc(title)}"><div class="cj-name">${esc(j.name)}<small class="cj-tag">${j.indCount}行业</small></div><div class="cj-bar"><div class="cj-range" style="left:${leftPct}%;width:${widthPct}%;background:${demandColors[d]}"></div><div class="cj-med" style="left:${medPct}%;border-color:${demandColors[d]}"></div></div><div class="cj-sal">${(j.median / 1000).toFixed(1)}k</div></div>`;
        }
        h += '</div></div>';
      }
      return h;
    }

    // 4. 渲染函数：行业展开视图（按职位名分组，展开显示各行业）
    function renderExpanded() {
      const groups = { '高': [], '中': [], '低': [] };
      for (const j of merged) { (groups[j.demand] || (groups[j.demand] = groups['中'])).push(j); }
      const allMax = Math.max(...allJobs.map(j => j.max), 1);
      let h = '';
      for (const d of demandOrder) {
        const jobs = groups[d] || [];
        if (!jobs.length) continue;
        jobs.sort((a, b) => b.median - a.median);
        const top = jobs.slice(0, 8);  // 展开视图显示更少的职位组，但每个组内有详情
        h += `<div class="cluster-group"><div class="cluster-label" style="border-left-color:${demandColors[d]}">${d}需求 <small style="color:#94a3b8;font-weight:400">${jobs.length} 个职位组 · 显示前${top.length}组（展开各行业）</small></div><div class="cluster-jobs">`;
        for (const j of top) {
          // 组标题行
          const leftPct = (j.min / allMax * 100).toFixed(1);
          const widthPct = Math.max(2, ((j.max - j.min) / allMax * 100)).toFixed(1);
          const medPct = (j.median / allMax * 100).toFixed(1);
          const title = `${j.name}（共${j.indCount}个行业）\n薪资范围: ${j.min}~${j.max}\n中位数: ${j.median}\n需求: ${j.demand}`;
          h += `<div class="cluster-job cj-group-head" title="${esc(title)}"><div class="cj-name"><b>${esc(j.name)}</b><small class="cj-tag">${j.indCount}行业</small></div><div class="cj-bar"><div class="cj-range" style="left:${leftPct}%;width:${widthPct}%;background:${demandColors[d]};opacity:.45"></div><div class="cj-med" style="left:${medPct}%;border-color:${demandColors[d]}"></div></div><div class="cj-sal"><b>${(j.median / 1000).toFixed(1)}k</b></div></div>`;
          // 组内各行职位（按薪资排序）
          const items = [...j.items].sort((a, b) => b.median - a.median);
          for (const it of items) {
            const lPct = (it.min / allMax * 100).toFixed(1);
            const wPct = Math.max(2, ((it.max - it.min) / allMax * 100)).toFixed(1);
            const mPct = (it.median / allMax * 100).toFixed(1);
            const itTitle = `${it.name} · ${it.cat}\n行业: ${it.code}\n薪资: ${it.min}~${it.max}\n中位数: ${it.median}\n需求: ${it.demand}`;
            h += `<div class="cluster-job cj-sub" title="${esc(itTitle)}"><div class="cj-name"><span class="cj-dot" style="background:${demandColors[d]}"></span>${esc(it.cat)}</div><div class="cj-bar"><div class="cj-range" style="left:${lPct}%;width:${wPct}%;background:${demandColors[d]};opacity:.6"></div><div class="cj-med sm" style="left:${mPct}%;border-color:${demandColors[d]}"></div></div><div class="cj-sal" style="color:#64748b">${(it.median / 1000).toFixed(1)}k</div></div>`;
          }
        }
        h += '</div></div>';
      }
      return h;
    }

    // 5. 初始渲染 + 视图切换
    let viewMode = 'merged'; // merged | expanded
    function render() {
      const h = viewMode === 'merged' ? renderMerged() : renderExpanded();
      const toggleBtn = `<div class="cluster-toggle">
        <button class="ct-btn ${viewMode === 'merged' ? 'on' : ''}" data-view="merged">合并视图</button>
        <button class="ct-btn ${viewMode === 'expanded' ? 'on' : ''}" data-view="expanded">行业展开</button>
      </div>`;
      $('#jobCluster').innerHTML = toggleBtn + `<div class="job-cluster">${h}</div>`;
      $$('.ct-btn', $('#jobCluster')).forEach(btn => {
        btn.onclick = () => { viewMode = btn.dataset.view; render(); };
      });
    }
    render();
  })();
}

// ================================================================== 城市分析
function pageAnaCity(c) {
  const ctx = getAnalyticsCtx();
  const { cityRows } = ctx;
  c.innerHTML = `
  <div class="ana-grid">
    <div class="card fade-in">${cardHead('C', '城市风险分布', '各城市风险等级占比')}
      <div class="card-bd" id="cityRiskDist"></div></div>
    <div class="card fade-in">${cardHead('P', '城市薪资购买力排行', '各城市薪资系数 vs 实际购买力')}
      <div class="card-bd"><div class="bars" id="cityPP"></div></div></div>
  </div>`;

  // 城市风险分布（堆叠条形图）
  (function() {
    const el = $('#cityRiskDist'); if (!el) return;
    const totalMax = Math.max(1, ...cityRows.map(x => x[1].total));
    const lvColors = { 'A': '#059669', 'B': '#3b82f6', 'C': '#d97706', 'D': '#dc2626' };
    el.innerHTML = cityRows.map(([cn, m]) => {
      const pct = m.total / totalMax * 100;
      const tot = m.total;
      const bar = (val, color) => val > 0 ? `<div style="height:100%;width:${(val/tot*100)}%;background:${color}"></div>` : '';
      return `<div class="city-risk-row"><div class="crr-lbl">${esc(cn)}</div><div class="crr-bar"><div class="crr-fill" style="width:${pct}%">${bar(m.aLow, lvColors.A)}${bar(m.bLow, lvColors.B)}${bar(m.mid, lvColors.C)}${bar(m.high, lvColors.D)}</div></div><div class="crr-vals"><span style="color:#059669">A:${m.aLow}</span><span style="color:#3b82f6">B:${m.bLow}</span><span style="color:#d97706">C:${m.mid}</span><span style="color:#dc2626">D:${m.high}</span></div></div>`;
    }).join('') + `<div class="legend" style="margin-top:10px"><span><i style="background:#059669"></i>A 低风险</span><span><i style="background:#3b82f6"></i>B 中低</span><span><i style="background:#d97706"></i>C 中等</span><span><i style="background:#dc2626"></i>D 高风险</span></div>`;
  })();

  // P 城市薪资购买力排行
  (function() {
    const cf = DB.city_factors || {};
    const allSal = Object.values(DB.salary).filter(s => s && s.monthly_median);
    const avgBase = allSal.length ? Math.round(allSal.reduce((a,s) => a + s.monthly_median, 0) / allSal.length) : 7000;
    const entries = Object.entries(cf).map(([city, f]) => ({ city, factor: f, nominal: Math.round(avgBase * f) })).sort((a,b) => b.factor - a.factor);
    const mx = Math.max(1, ...entries.map(x => x.nominal));
    $('#cityPP').innerHTML = entries.map(x => `<div class="bar-row ${x.factor >= 1.4 ? 'red' : x.factor >= 1.1 ? 'gold' : 'green'}"><div class="bl">${esc(x.city)}</div><div class="bt"><div class="bf" style="width:${(x.nominal/mx*100).toFixed(1)}%;background:linear-gradient(90deg,#3b82f6,#2563eb)"></div></div><div class="bv">${(x.nominal/1000).toFixed(1)}k <small style="color:#94a3b8;font-weight:400">系数${x.factor}</small></div></div>`).join('');
  })();
}

// ================================================================== 薪资分析
function pageAnaSalary(c) {
  const ctx = getAnalyticsCtx();
  const { inds, jobs, salaryStats, salaryBins, sMax } = ctx;
  c.innerHTML = `
  <div class="ana-grid">
    <div class="card fade-in">${cardHead('F', '职业薪资分布', `${salaryStats.length} 个职业的月薪中位数分布`)}
      <div class="card-bd"><div class="bars">
        ${Object.entries(salaryBins).map(([n, v]) => `<div class="bar-row ${n.includes('20k') || n.includes('12-20') ? 'green' : n.includes('8-12') ? '' : n.includes('5-8') ? 'gold' : n.includes('3-5') ? 'orange' : 'red'}"><div class="bl">${esc(n)}</div><div class="bt"><div class="bf" style="width:${(v / sMax * 100).toFixed(1)}%"></div></div><div class="bv">${v}</div></div>`).join('')}
      </div>
      <p class="hint" style="margin-top:10px">基于国家统计局行业基准薪资，含各城市调整系数</p>
      </div></div>
    <div class="card fade-in">${cardHead('N', '职业交叉行业薪资矩阵', '同一职位在不同行业的薪资对比')}
      <div class="card-bd"><div class="tbl-wrap" id="crossJob2"></div></div></div>
  </div>`;

  // N 职业交叉行业薪资矩阵
  (function() {
    const jobIndMap = {};
    for (const j of jobs) {
      const jn = j['常见职位'];
      if (!jobIndMap[jn]) jobIndMap[jn] = [];
      const sk = Object.keys(DB.salary).find(k => k.endsWith('|' + jn));
      const sd = sk ? DB.salary[sk] : null;
      jobIndMap[jn].push({ code: j['行业编号'], salary: sd });
    }
    const crossJobs = Object.entries(jobIndMap).filter(([k,v]) => v.length > 1).sort((a,b) => b[1].length-a[1].length).slice(0, 15);
    if (!crossJobs.length) { $('#crossJob2').innerHTML = '<p class="hint">暂无跨行业职业数据</p>'; return; }
    let h = '<table class="tbl compact"><thead><tr><th>职位</th><th>出现行业数</th><th>基准月薪范围</th><th>薪资差异</th></tr></thead><tbody>';
    for (const [jn, arr] of crossJobs) {
      const sals = arr.map(x => x.salary).filter(Boolean);
      if (!sals.length) continue;
      const mins = Math.min(...sals.map(s => s.monthly_median));
      const maxs = Math.max(...sals.map(s => s.monthly_median));
      const diff = maxs - mins;
      const diffPct = mins > 0 ? (diff/mins*100).toFixed(0) : 0;
      h += `<tr><td><b>${esc(jn)}</b></td><td>${arr.length}</td><td>${(mins/1000).toFixed(1)}k - ${(maxs/1000).toFixed(1)}k</td><td><span class="tag ${diffPct > 30 ? 'red' : diffPct > 15 ? 'gold' : 'green'}">+${diffPct}%</span></td></tr>`;
    }
    h += '</tbody></table>';
    $('#crossJob2').innerHTML = h;
  })();
}

// ================================================================== 风险分析
function pageAnaRisk(c) {
  const ctx = getAnalyticsCtx();
  const { inds, risks, cities, t, lvMap, lvTotal, indRisk, topRisk, bestRisk } = ctx;
  c.innerHTML = `
  <div class="ana-grid">
    <div class="card fade-in">${cardHead('B', '全库风险层级分布', 'A 低 → D 高')}
      <div class="card-bd"><div class="bars">
        ${Object.entries(lvMap).sort((a, b) => b[1] - a[1]).map(([n, v]) => `<div class="bar-row ${/^[D]/.test(n) ? 'red' : /^C/.test(n) ? 'gold' : /^B/.test(n) ? '' : 'green'}"><div class="bl">${esc(n)}级</div><div class="bt"><div class="bf" style="width:${(v / lvTotal * 100).toFixed(1)}%"></div></div><div class="bv">${v} <small style="color:#94a3b8;font-weight:400">${(v / lvTotal * 100).toFixed(1)}%</small></div></div>`).join('')}
      </div></div></div>
    <div class="card fade-in">${cardHead('D', '行业风险热力矩阵', `${t.行业} 行业 × ${t.城市} 城市 · 点击跳转`)}
      <div class="card-bd"><div class="heat-wrap" id="heatWrap"></div>
        <div class="legend"><span><i class="hc-A"></i>A 低风险</span><span><i class="hc-B"></i>B 中低</span><span><i class="hc-C"></i>C 中等</span><span><i class="hc-D"></i>D 高风险</span></div>
      </div></div>
    <div class="card fade-in">${cardHead('E', '行业风险指数排行', '20城层级平均分（A=1→D=4）')}
      <div class="card-bd">
        <div class="btn-row" style="margin-bottom:11px"><button class="btn sm on" data-rk="high">风险最高 TOP 20</button><button class="btn sm" data-rk="low">风险最低 TOP 15</button></div>
        <div id="rankBox"></div>
      </div></div>
    <div class="card fade-in">${cardHead('R', '风险-利润象限图', 'X=风险指数 Y=毛利率')}
      <div class="card-bd"><div class="scatter-plot quad" id="quadPlot"></div>
        <div class="scatter-legend"><span><i style="background:#dc2626"></i>高风险高利润</span><span><i style="background:#059669"></i>低风险高利润</span><span><i style="background:#d97706"></i>高风险低利润</span><span><i style="background:#64748b"></i>低风险低利润</span></div>
      </div></div>
  </div>`;

  // 热力矩阵
  (function() {
    const cityNames = cities.map(x => x['城市名称']);
    const riskByInd = new Map();
    for (const r of risks) { if (!riskByInd.has(r['行业编号'])) riskByInd.set(r['行业编号'], new Map()); riskByInd.get(r['行业编号']).set(r['城市'], r['风险层级']); }
    let h = '<table class="heat"><thead><tr><th style="left:0;z-index:4;background:#f8fafc">行业</th>' + cityNames.map(n => `<th>${esc(n)}</th>`).join('') + '</tr></thead><tbody>';
    for (const a of indRisk) {
      const m = riskByInd.get(a['行业编号']) || new Map();
      h += `<tr><td class="rowh" title="${esc(a['行业编号'] + ' ' + a['细分行业'])}">${esc(a['行业编号'])} ${esc(a['细分行业'])}</td>` + cityNames.map(cn => {
        const v = m.get(cn) || '';
        const nv = normLv(v);
        return `<td class="c ${heatClass(v)}" data-i="${esc(a['行业编号'])}" data-c="${esc(cn)}" title="${esc(a['行业编号'] + ' · ' + cn + '：' + nv)}">${esc(nv)}</td>`;
      }).join('') + '</tr>';
    }
    h += '</tbody></table>';
    $('#heatWrap').innerHTML = h;
    $$('#heatWrap td.c').forEach(td => {
      td.onclick = () => { S.dash = { industry: td.dataset.i, job: '', city: td.dataset.c, ci: new Set([td.dataset.i]), cj: new Set(), cc: new Set([td.dataset.c]), queried: true }; go('dashboard'); };
    });
  })();

  // 排行
  const renderRank = (mode) => {
    const list = mode === 'high' ? topRisk : bestRisk;
    const mx = Math.max(...list.map(x => x.风险指数 || 0), 1);
    $('#rankBox').innerHTML = `<div class="bars">${list.map(x => `<div class="bar-row ${x.风险指数 >= 4 ? 'red' : x.风险指数 >= 3 ? 'orange' : x.风险指数 >= 2 ? 'gold' : 'green'}"><div class="bl" style="cursor:pointer" title="点击跳转看板">${esc(x['行业编号'])} ${esc(x['细分行业'])}</div><div class="bt"><div class="bf" style="width:${(x.风险指数 / mx * 100).toFixed(1)}%"></div></div><div class="bv">${x.风险指数} <small style="color:#94a3b8;font-weight:400">${esc(x['最高风险城市'] || '')}</small></div></div>`).join('')}</div>`;
    $$('#rankBox .bar-row .bl').forEach((el, i) => {
      el.onclick = () => { S.dash = { industry: list[i]['行业编号'], job: '', city: '', ci: new Set([list[i]['行业编号']]), cj: new Set(), cc: new Set(), queried: true }; go('dashboard'); };
    });
  };
  renderRank('high');
  $$('[data-rk]').forEach(b => { b.onclick = () => { $$('[data-rk]').forEach(x => x.classList.remove('on')); b.classList.add('on'); renderRank(b.dataset.rk); }; });

  // R 风险-利润象限图
  (function() {
    const parsePct2 = (s) => { const m = String(s||'').match(/(\d+(?:\.\d+)?)/); return m ? Number(m[0]) : null; };
    const pts = indRisk.filter(x => {
      const ind = inds.find(i => i['行业编号'] === x['行业编号']);
      return ind && parsePct2(ind['毛利率区间']) != null;
    }).map(x => {
      const ind = inds.find(i => i['行业编号'] === x['行业编号']);
      return { x: x.风险指数, y: parsePct2(ind['毛利率区间']), name: x['细分行业'], code: x['行业编号'] };
    });
    if (!pts.length) { $('#quadPlot').innerHTML = '<p class="hint">暂无数据</p>'; return; }
    const maxX = 5, maxY = Math.max(25, ...pts.map(p => p.y));
    const dots = pts.map(p => {
      const hiRisk = p.x >= 3, hiProf = p.y >= 15;
      const color = hiRisk && hiProf ? '#dc2626' : !hiRisk && hiProf ? '#059669' : hiRisk && !hiProf ? '#d97706' : '#64748b';
      return `<div class="sdot" style="left:${(p.x/maxX*100).toFixed(1)}%;bottom:${(p.y/maxY*100).toFixed(1)}%;background:${color}" title="${esc(p.name)}：风险${p.x} 毛利率${p.y}%"></div>`;
    }).join('');
    $('#quadPlot').innerHTML = `<div class="scatter-area quad">${dots}<div class="quad-line-v" style="left:60%"></div><div class="quad-line-h" style="bottom:${(15/maxY*100).toFixed(1)}%"></div></div>`;
  })();
}

// ================================================================== 资金分析
function pageAnaFinance(c) {
  const ctx = getAnalyticsCtx();
  const { inds } = ctx;
  c.innerHTML = `
  <div class="ana-grid">
    <div class="card fade-in">${cardHead('K', '季节性资金缺口时间轴', '按月份排列资金需求高峰')}
      <div class="card-bd"><div id="fundGap"></div></div></div>
    <div class="card fade-in">${cardHead('L', '典型融资用途分类统计', '融资用途关键词频次')}
      <div class="card-bd"><div class="bars" id="fundUse"></div></div></div>
    <div class="card fade-in">${cardHead('S', '资金需求紧迫度排行', '综合融资+资金缺口+淡旺季评分')}
      <div class="card-bd"><div class="bars" id="fundRank"></div></div></div>
  </div>`;

  // K 季节性资金缺口时间轴
  (function() {
    const monthMap = { '年初':1, '春节':2, '一季度':1, '春节前':1, '3':3, '4':4, '复工':3, '9':9, '10':10, '年底':12, '四季度':10, '三季度':7 };
    const gaps = [];
    for (const ind of inds) {
      const txt = String(ind['季节性资金缺口高峰'] || '');
      if (!txt || txt === '—') continue;
      const found = [];
      for (const [k, m] of Object.entries(monthMap)) { if (txt.includes(k)) found.push(m); }
      const mMatch = txt.match(/(\d+)月/g);
      if (mMatch) for (const mm of mMatch) { const mi = parseInt(mm); if (mi>=1 && mi<=12) found.push(mi); }
      const months = [...new Set(found)].sort((a,b)=>a-b);
      gaps.push({ name: ind['细分行业'], code: ind['行业编号'], months, text: txt });
    }
    if (!gaps.length) { $('#fundGap').innerHTML = '<p class="hint">暂无资金缺口数据</p>'; return; }
    const months2 = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
    let h = '<table class="cal-tbl"><thead><tr><th>行业</th>' + months2.map(m => `<th>${m}</th>`).join('') + '</tr></thead><tbody>';
    for (const g of gaps.slice(0, 30)) {
      h += `<tr><td class="rowh" title="${esc(g.text)}">${esc(g.name)}</td>`;
      for (let i = 1; i <= 12; i++) { const on = g.months.includes(i); h += `<td class="cal-c" style="background:${on ? 'rgba(220,38,38,0.7)' : ''}">${on ? '⚠' : ''}</td>`; }
      h += '</tr>';
    }
    h += '</tbody></table>';
    $('#fundGap').innerHTML = h;
  })();

  // L 融资用途分类统计
  (function() {
    const kw = ['保证金','垫资','工资','采购','进货','设备','租金','装修','扩建','周转','还贷','税款','社保','工程款','材料'];
    const freq = {};
    for (const ind of inds) { const txt = String(ind['典型融资用途'] || ''); for (const k of kw) { if (txt.includes(k)) freq[k] = (freq[k]||0) + 1; } }
    const sorted = Object.entries(freq).sort((a,b) => b[1]-a[1]);
    const mx = Math.max(1, ...sorted.map(x => x[1]));
    $('#fundUse').innerHTML = sorted.map(([n,v]) => `<div class="bar-row"><div class="bl">${esc(n)}</div><div class="bt"><div class="bf" style="width:${(v/mx*100).toFixed(1)}%"></div></div><div class="bv">${v} <small style="color:#94a3b8;font-weight:400">${(v/inds.length*100).toFixed(0)}%</small></div></div>`).join('');
  })();

  // S 资金需求紧迫度排行
  (function() {
    const scored = inds.map(ind => {
      const fund = String(ind['典型融资用途'] || ''); const gap = String(ind['季节性资金缺口高峰'] || '');
      let score = 0;
      ['保证金','垫资','工资','设备','周转'].forEach(k => { if (fund.includes(k)) score += 3; });
      if (gap.includes('春节')) score += 5;
      if (gap.includes('年初')) score += 3;
      if (gap.includes('最大') || gap.includes('高峰')) score += 2;
      const peak = String(ind['旺季月份']||'');
      if (peak.includes('3') || peak.includes('9')) score += 2;
      return { name: ind['细分行业'], code: ind['行业编号'], score };
    }).filter(x => x.score > 0).sort((a,b) => b.score - a.score);
    const top = scored.slice(0, 20);
    const mx = Math.max(1, ...top.map(x => x.score));
    $('#fundRank').innerHTML = `<div class="bars">${top.map(x => `<div class="bar-row ${x.score >= 15 ? 'red' : x.score >= 10 ? 'orange' : 'gold'}"><div class="bl" style="cursor:pointer">${esc(x.code)} ${esc(x.name)}</div><div class="bt"><div class="bf" style="width:${(x.score/mx*100).toFixed(1)}%"></div></div><div class="bv">${x.score}分</div></div>`).join('')}</div>`;
    $$('#fundRank .bar-row .bl').forEach((el, i) => {
      el.onclick = () => { S.dash = { industry: top[i].code, job: '', city: '', ci: new Set([top[i].code]), cj: new Set(), cc: new Set(), queried: true }; go('dashboard'); };
    });
  })();
}

// ================================================================== 管理页
function dataTablePage(c, cfg) {
  const allData = applyEdits(cfg.name, DB[cfg.name]);
  const st = { page: 1, size: cfg.size || 50, q: '', total: 0 };

  c.innerHTML = `
    <div class="card">
      ${cardHead(cfg.no || '', cfg.title, cfg.sub || '')}
      <div class="card-bd">
        <div class="toolbar">
          <input type="text" id="fQ" placeholder="关键词全文检索…">
          <span class="sp"></span>
          <span class="hint" id="cnt"></span>
          <button class="btn" id="bExp">⬇ 导出本页数据</button>
        </div>
        <div class="tbl-wrap" id="tw"></div>
        <div class="pager" id="pg"></div>
      </div>
    </div>`;

  function reload() {
    let rows = allData;
    if (st.q) {
      const kw = st.q.toLowerCase();
      rows = rows.filter(r => Object.values(r).some(v => String(v || '').toLowerCase().includes(kw)));
    }
    st.total = rows.length;
    const start = (st.page - 1) * st.size;
    const pageRows = rows.slice(start, start + st.size);
    $('#cnt').textContent = `共 ${st.total} 条`;
    renderRows(pageRows);
    renderPager();
  }

  function renderRows(rows) {
    if (!rows.length) { $('#tw').innerHTML = '<div class="empty"><span class="big">🗂</span>没有匹配的记录</div>'; return; }
    const cols = cfg.columns;
    $('#tw').innerHTML = `<table class="tbl"><thead><tr>${cols.map(x => `<th>${esc(x.t)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(r => `<tr>${cols.map(x => {
        const v = x.f ? x.f(r) : r[x.k];
        if (x.cls === 'lv') return `<td><span class="lv ${lvClass(v)}">${esc(v || '—')}</span></td>`;
        if (x.cls === 'code') return `<td class="code">${esc(v || '')}</td>`;
        return `<td class="${x.wrap === false ? '' : 'wrap'}">${x.raw ? v : nl2br(v)}</td>`;
      }).join('')}</tr>`).join('')}</tbody></table>`;
  }

  function renderPager() {
    const pages = Math.max(1, Math.ceil(st.total / st.size));
    $('#pg').innerHTML = `
      <button class="btn sm" id="pPrev" ${st.page <= 1 ? 'disabled' : ''}>上一页</button>
      <span>第 ${st.page} / ${pages} 页（${st.total} 条）</span>
      <button class="btn sm" id="pNext" ${st.page >= pages ? 'disabled' : ''}>下一页</button>
      <select id="pSize">${[20, 50, 100, 200].map(n => `<option value="${n}"${n === st.size ? ' selected' : ''}>${n} 条/页</option>`).join('')}</select>`;
    $('#pPrev').onclick = () => { st.page--; reload(); };
    $('#pNext').onclick = () => { st.page++; reload(); };
    $('#pSize').onchange = (e) => { st.size = Number(e.target.value); st.page = 1; reload(); };
  }

  $('#fQ').oninput = debounce((e) => { st.q = e.target.value.trim(); st.page = 1; reload(); }, 280);
  $('#bExp').onclick = () => {
    const data = JSON.stringify(allData, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `xwk_${cfg.name}_${Date.now()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('已开始下载', a.download);
  };
  reload();
}

function pageIndustries(c) {
  dataTablePage(c, {
    name: 'industries', no: '01', title: '行业管理（行业档案 + 前景利润淡旺季）',
    sub: `共 ${DB.meta.industry_count} 个细分行业`,
    columns: [
      { t: '编号', k: '行业编号', cls: 'code', wrap: false },
      { t: '门类', k: '行业门类', wrap: false },
      { t: '细分行业', k: '细分行业', wrap: false },
      { t: '典型经营主体形态', k: '典型经营主体形态' },
      { t: '必备证照资质', k: '必备证照资质' },
      { t: '常见经营规模', k: '常见经营规模' },
      { t: '前景趋势判断', k: '前景趋势判断' },
      { t: '毛利率', k: '毛利率区间', wrap: false },
      { t: '净利率', k: '净利率区间', wrap: false },
    ],
    size: 50,
  });
}

function pageJobs(c) {
  dataTablePage(c, {
    name: 'jobs', no: '04', title: '职业管理（在职客户岗位核实）',
    sub: `共 ${DB.meta.job_count} 条岗位明细`,
    columns: [
      { t: '编号', k: '行业编号', cls: 'code', wrap: false },
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
  dataTablePage(c, {
    name: 'city_risks', no: '05', title: '城市风控（行业 × 城市 风险分级）',
    sub: `共 ${DB.meta.city_risk_count} 条 = ${DB.meta.industry_count} 行业 × ${DB.meta.city_count} 城市`,
    columns: [
      { t: '编号', k: '行业编号', cls: 'code', wrap: false },
      { t: '城市', k: '城市', wrap: false },
      { t: '风险层级', k: '风险层级', cls: 'lv', wrap: false },
      { t: '定级依据与尽调要点', k: '依据与尽调要点' },
    ],
    size: 50,
  });
}

function pageModes(c) {
  dataTablePage(c, {
    name: 'modes', no: '02', title: '经营模式详解',
    sub: `共 ${DB.meta.mode_count} 条模式`,
    columns: [
      { t: '编号', k: '行业编号', cls: 'code', wrap: false },
      { t: '细分模式', k: '细分模式', wrap: false },
      { t: '运作方式', k: '运作方式' },
      { t: '盈利逻辑', k: '盈利逻辑' },
      { t: '上下游与结算回款', k: '上下游与结算回款方式' },
      { t: '成本结构', k: '成本结构' },
      { t: '资金需求特点与周期', k: '资金需求特点与周期' },
      { t: '授信关注要点', k: '授信关注要点' },
    ],
    size: 50,
  });
}

// ================================================================== 全局搜索
function pageSearch(c) {
  c.innerHTML = `
    <div class="card">${cardHead('🔍', '全局搜索', '跨行业/职业/经营模式/城市风险/城市 五类数据')}
      <div class="card-bd">
        <div class="toolbar">
          <input type="text" id="gsQ" placeholder="输入关键词，如：挂靠、社保、光伏贷、重庆…" style="flex:1;min-width:280px">
          <button class="btn green" id="gsBtn">搜索</button>
        </div>
        <div id="gsRes"><div class="empty"><span class="big">🔍</span>输入关键词开始检索<br><small>支持按行话、证件名、风险点、城市名等任意字段全文匹配</small></div></div>
      </div></div>`;
  const run = () => {
    const q = $('#gsQ').value.trim().toLowerCase();
    if (!q) return;
    $('#gsRes').innerHTML = '<div class="loading"><span class="spin"></span>检索中…</div>';

    const inds = applyEdits('industries', DB.industries);
    const jobs = applyEdits('jobs', DB.jobs);
    const modes = applyEdits('modes', DB.modes);
    const risks = applyEdits('city_risks', DB.city_risks);

    const match = (obj, fields) => fields.some(f => String(obj[f] || '').toLowerCase().includes(q));
    const groups = [
      ['industries', '🏢 行业档案', inds, ['行业编号', '行业门类', '细分行业', '典型经营主体形态', '必备证照资质', '常见经营规模', '订单与客户来源', '典型融资用途', '前景趋势判断', '毛利率区间', '净利率区间', '旺季月份', '淡季月份', '季节性资金缺口高峰', '主要经营风险', '政策与外部驱动', '职业标签串']],
      ['jobs', '👥 职业核实', jobs, ['行业编号', '常见职位', '这个岗位每天干什么', '审核时怎么问', '能查到哪些证据', '真干过的人怎么答', '没干过的破绽', '审批要点']],
      ['modes', '🧩 经营模式', modes, ['行业编号', '细分模式', '运作方式', '盈利逻辑', '上下游与结算回款方式', '成本结构', '资金需求特点与周期', '授信关注要点']],
      ['city_risks', '🏙 城市风险', risks, ['行业编号', '城市', '风险层级', '依据与尽调要点']],
    ];

    let total = 0, h = '';
    for (const [k, title, data, fields] of groups) {
      const results = data.filter(r => match(r, fields)).slice(0, 40);
      if (!results.length) continue;
      total += results.length;
      h += `<div class="sr-group"><div class="gt">${esc(title)}<span class="c">${results.length}</span></div>
        ${results.map(x => {
          const key = keyOf(k, x);
          const titleField = k === 'industries' ? x['细分行业'] : k === 'jobs' ? x['常见职位'] : k === 'modes' ? x['细分模式'] : x['城市'];
          const subField = k === 'industries' ? x['行业门类'] : k === 'jobs' ? x['行业编号'] : k === 'modes' ? x['行业编号'] : x['行业编号'];
          const hitFields = fields.filter(f => String(x[f] || '').toLowerCase().includes(q));
          return `<div class="sr-item" data-k="${esc(key)}" data-type="${k}">
            <div class="t">${hlText(titleField, q)}</div>
            <div class="s">${esc(subField || '')}</div>
            <div class="hf">${hitFields.map(f => `<span class="tag gray">${esc(lb(f))}</span>`).join('')}</div>
          </div>`;
        }).join('')}</div>`;
    }

    $('#gsRes').innerHTML = total
      ? `<p class="hint" style="margin-bottom:11px">关键词「<b>${esc(q)}</b>」共命中 <b>${total}</b> 条，点击可跳转到看板定位。</p>${h}`
      : `<div class="empty"><span class="big">🈳</span>没有找到包含「${esc(q)}」的内容</div>`;

    $$('#gsRes .sr-item').forEach(el => {
      el.onclick = () => {
        const k = el.dataset.k;
        const parts = k.split('|');
        if (el.dataset.type === 'city_risks') {
          S.dash = { industry: parts[0] || '', job: '', city: parts[1] || '', ci: new Set(parts[0] ? [parts[0]] : []), cj: new Set(), cc: new Set(parts[1] ? [parts[1]] : []), queried: true };
        } else {
          S.dash = { industry: parts[0], job: '', city: '', ci: new Set([parts[0]]), cj: new Set(), cc: new Set(), queried: true };
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

// ================================================================== 数据更新中心
function pageDataUpdate(c) {
  const m = DB.meta;
  const jobCount = DB.jobs.length;
  const salaryCount = Object.keys(DB.salary).length;
  const lastUpdate = new Date().toLocaleDateString('zh-CN');

  c.innerHTML = `
    <div class="update-grid fade-in">
      <div class="update-card">
        <div class="uh"><span class="ui">📊</span><span class="ut">行业数据</span></div>
        <div class="uv">${m.industry_count}</div>
        <div class="ud">细分行业覆盖<br>含前景、利润、淡旺季等16个维度</div>
      </div>
      <div class="update-card">
        <div class="uh"><span class="ui">👥</span><span class="ut">职业数据</span></div>
        <div class="uv">${jobCount}</div>
        <div class="ud">岗位核实明细<br>含审核话术、破绽识别、审批要点</div>
      </div>
      <div class="update-card">
        <div class="uh"><span class="ui">💰</span><span class="ut">薪资数据</span></div>
        <div class="uv">${salaryCount}</div>
        <div class="ud">2020-2026年7年趋势<br>含月薪范围、年薪、增长率、需求热度</div>
      </div>
      <div class="update-card">
        <div class="uh"><span class="ui">🏙</span><span class="ut">城市风控</span></div>
        <div class="uv">${m.city_risk_count}</div>
        <div class="ud">${m.city_count}城市×${m.industry_count}行业<br>含风险层级与尽调要点</div>
      </div>
    </div>

    <div class="card fade-in">${cardHead('🔄', '数据自动更新', '系统每周自动更新数据')}
      <div class="card-bd">
        <p class="hint" style="margin-bottom:14px">本知识库每周自动更新薪资和行业数据，无需手动操作。</p>
        <div style="padding:12px 14px;background:#f0fdf4;border-radius:8px;border-left:3px solid #059669">
          <p class="hint" style="margin:0">当前数据版本：<b>${lastUpdate}</b><br>
          更新频率：每周一次（周一）<br>
          数据来源：国家统计局 + 各地人社局</p>
        </div>
      </div>
    </div>

    <div class="card fade-in">${cardHead('💰', '薪资数据来源说明', '当前薪资数据的获取渠道和计算方法')}
      <div class="card-bd">
        <table class="tbl">
          <thead><tr><th>数据源</th><th>来源说明</th><th>用途</th><th>更新频率</th></tr></thead>
          <tbody>
            <tr><td>国家统计局</td><td>2025年分行业平均工资（城镇非私营单位）</td><td>行业基准薪资</td><td>年度</td></tr>
            <tr><td>各地人社局</td><td>20个城市2025年企业工资价位</td><td>城市薪资系数</td><td>年度</td></tr>
            <tr><td>行业增长率</td><td>统计局2025年分行业工资同比增长率</td><td>年度趋势推算</td><td>年度</td></tr>
            <tr><td>职位倍数</td><td>基于人社局职位工资价位</td><td>职位间薪资差异</td><td>半年</td></tr>
          </tbody>
        </table>
        <div style="margin-top:12px;padding:12px 14px;background:#f0fdf4;border-radius:8px;border-left:3px solid #059669">
          <p class="hint" style="margin:0"><b>计算方法</b>：行业基准薪资 × 职位倍数 = 基准月薪；基准月薪 × 城市系数 = 城市薪资；按行业年增长率推算2020-2026年趋势。<br>
          <b>数据特点</b>：各行业增长率不同（+1.9%~+10.3%），各城市系数不同（北京1.85 vs 重庆0.94），体现真实差异。</p>
        </div>
      </div>
    </div>

    <div class="card fade-in">${cardHead('📋', '数据维度总览', '当前知识库包含的全部数据维度')}
      <div class="card-bd">
        <table class="tbl">
          <thead><tr><th>数据集</th><th>记录数</th><th>维度</th><th>更新频率</th></tr></thead>
          <tbody>
            <tr><td>行业档案</td><td>${m.industry_count}</td><td>16个字段（含门类、形态、证照、规模、前景等）</td><td>季度</td></tr>
            <tr><td>经营模式</td><td>${m.mode_count}</td><td>6个字段（运作方式、盈利逻辑、成本结构等）</td><td>季度</td></tr>
            <tr><td>职业核实</td><td>${jobCount}</td><td>6个字段（岗位内容、审核话术、破绽识别等）</td><td>月度</td></tr>
            <tr><td>城市风控</td><td>${m.city_risk_count}</td><td>4个字段（行业×城市风险层级与尽调）</td><td>半年</td></tr>
            <tr><td>薪资趋势</td><td>${salaryCount}</td><td>7年趋势（2020-2026月薪/年薪/增长率/需求）</td><td>月度</td></tr>
            <tr><td>城市信息</td><td>${m.city_count}</td><td>2个字段（城市名称、定位标签）</td><td>年度</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ================================================================== 页面注册
const PAGES = {
  dashboard: pageDashboard,
  'ana-industry': pageAnaIndustry,
  'ana-job': pageAnaJob,
  'ana-city': pageAnaCity,
  'ana-salary': pageAnaSalary,
  'ana-risk': pageAnaRisk,
  'ana-finance': pageAnaFinance,
  industries: pageIndustries,
  jobs: pageJobs,
  cityrisks: pageCityRisks,
  modes: pageModes,
  search: pageSearch,
  dataupdate: pageDataUpdate,
};

function debounce(fn, ms) {
  let t; return function () { clearTimeout(t); const a = arguments; t = setTimeout(() => fn.apply(this, a), ms); };
}

// 自动填充演示账号
$('#loginUser').value = 'admin';
$('#loginPass').value = 'wt1201263';
