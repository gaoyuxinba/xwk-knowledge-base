/* ============================================================
   小微行业知识库看板 V3 · 纯静态版
   数据全部内嵌，无后端依赖
   ============================================================ */
'use strict';

// ------------------------------------------------------------------ 数据合并
const DB = {
  meta: window.XWK_DATA_1 ? window.XWK_DATA_1.meta : {},
  industries: window.XWK_DATA_1 ? window.XWK_DATA_1.industries : [],
  modes: window.XWK_DATA_1 ? window.XWK_DATA_1.modes : [],
  cities: window.XWK_DATA_1 ? window.XWK_DATA_1.cities : [],
  jobs: window.XWK_DATA_2 ? window.XWK_DATA_2.jobs : [],
  city_risks: window.XWK_DATA_3 ? window.XWK_DATA_3.city_risks : [],
  salary: window.XWK_DATA_4 ? window.XWK_DATA_4.salary : {},
  city_factors: window.XWK_DATA_4 ? window.XWK_DATA_4.city_factors : {},
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
    { id: 'analytics', ico: '📈', t: '统计分析' },
  ]},
  { g: '知识管理', items: [
    { id: 'industries', ico: '🏢', t: '行业管理', badge: () => DB.meta.industry_count },
    { id: 'jobs', ico: '👥', t: '职业管理', badge: () => DB.meta.job_count },
    { id: 'cityrisks', ico: '🏙', t: '城市风控', badge: () => DB.meta.city_risk_count },
    { id: 'modes', ico: '🧩', t: '经营模式', badge: () => DB.meta.mode_count },
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
  $$('.nav-item', nav).forEach((el) => { el.onclick = () => go(el.dataset.page); });
}

const PAGE_TITLE = {
  dashboard: '数据看板', analytics: '统计分析', industries: '行业管理', jobs: '职业管理',
  cityrisks: '城市风控', modes: '经营模式', search: '全局搜索', dataupdate: '数据更新中心',
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

$('#loginForm').onsubmit = (e) => {
  e.preventDefault();
  const u = $('#loginUser').value.trim();
  const p = $('#loginPass').value;
  const acc = ACCOUNTS.find(a => a.user === u && a.pass === p);
  if (!acc) {
    $('#loginErr').textContent = '账号或密码不正确';
    return;
  }
  S.user = acc;
  $('#loginView').hidden = true;
  $('#appView').hidden = false;
  $('#userName').textContent = acc.name;
  $('#userRole').textContent = acc.role === 'admin' ? '管理员' : '浏览者';
  $('#userAvatar').textContent = acc.name[0];
  renderNav();
  renderMeta();
  go('dashboard');
};

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
  c.innerHTML = `
    <div class="qbar">
      <div class="qbox">
        <div class="qt"><span class="n">1</span>行业查询</div>
        <input type="text" id="qInd" placeholder="输入行业编号、名称或关键词（如 劳务、火锅、软件）" value="${esc(q.industry)}">
        <div class="qmeta" id="mInd">输入关键词后点选下方标签</div>
        <div class="chipbar" id="chInd"></div>
        <div class="qhint" id="hInd"></div>
      </div>
      <div class="qbox">
        <div class="qt"><span class="n">2</span>职业搜索</div>
        <input type="text" id="qJob" placeholder="输入职位关键词（如 技术员、店长、司机）" value="${esc(q.job)}" ${q.ci.size ? '' : 'disabled'}>
        <div class="qmeta" id="mJob">—</div>
        <div class="chipbar" id="chJob"></div>
        <div class="qhint" id="hJob"></div>
      </div>
      <div class="qbox">
        <div class="qt"><span class="n">3</span>城市筛选</div>
        <input type="text" id="qCity" placeholder="输入城市或定位关键词（如 重庆、港口）" value="${esc(q.city)}">
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
    <div id="dashBody">
      <div class="empty"><span class="big">📋</span>选择行业、职业和城市筛选条件后点击「查询数据」查看详情<br><small>支持多选：点击多个标签可同时选中</small></div>
    </div>
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
  if (q.queried) renderDash();
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
      html += sec06(selectedCodes.length === 1 ? selectedCodes[0] : '', selectedJobs);
    } else if (jobRecords.length) {
      html += sec06(selectedCodes.length === 1 ? selectedCodes[0] : '', jobRecords.slice(0, 3).map(j => j['常见职位']));
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
  return `<div class="card-hd"><h3><span class="no">${no}</span>${esc(title)}</h3>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;
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
    return `<div class="card fade-in">${cardHead('05', '城市风险分级（A 低 → E 高）', '无匹配')}
      <div class="card-bd"><div class="empty"><span class="big">🏙</span>无匹配城市风险数据</div></div></div>`;
  }
  const body = `<div class="tbl-wrap"><table class="risk-tbl">
    <thead><tr><th>城市</th><th>风险层级</th><th>定级依据与尽调要点</th></tr></thead>
    <tbody>${rows.map(r => `<tr>
      <td class="city">${esc(r['城市'])}</td>
      <td class="lvcell">${hasInd ? `<span class="lv ${lvClass(r['风险层级'])}">${esc(r['风险层级'] || '—')}</span>` : '<span style="color:#cbd5e1">—</span>'}</td>
      <td class="basis">${hasInd ? nl2br(r['依据与尽调要点']) : '<span style="color:#cbd5e1">请先选定行业</span>'}</td>
    </tr>`).join('')}</tbody></table></div>`;
  return `<div class="card fade-in">${cardHead('05', '城市风险分级（A 低 → E 高）', `${rows.length} 条记录`)}
    <div class="card-bd">${body}
      <div class="legend">
        <span><i style="background:var(--lv-a-bg);border:1px solid var(--lv-a)"></i>A 低</span>
        <span><i style="background:var(--lv-bc-bg);border:1px solid var(--lv-bc)"></i>B/B-C 中低</span>
        <span><i style="background:var(--lv-c-bg);border:1px solid var(--lv-c)"></i>C 中等</span>
        <span><i style="background:var(--lv-cd-bg);border:1px solid var(--lv-cd)"></i>C-D 中高</span>
        <span><i style="background:var(--lv-d-bg);border:1px solid var(--lv-d)"></i>D 中高</span>
        <span><i style="background:var(--lv-e-bg);border:1px solid var(--lv-e)"></i>E 高</span>
      </div>
    </div></div>`;
}

// 06 薪资趋势
function sec06(indCode, jobNames) {
  if (!jobNames || !jobNames.length) return '';
  const cards = jobNames.map(jn => {
    const key = indCode ? `${indCode}|${jn}` : Object.keys(DB.salary).find(k => k.endsWith('|' + jn));
    const sd = key ? DB.salary[key] : null;
    if (!sd) return '';

    const trend = sd.trend || {};
    const years = Object.keys(trend).sort();
    if (!years.length) return '';
    const maxVal = Math.max(...years.map(y => trend[y].max));
    const minVal = Math.min(...years.map(y => trend[y].min));

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

    return `<div class="salary-card fade-in">
      <div class="card-hd"><h3><span class="no">06</span>${esc(jn)} · 薪资趋势分析</h3><div class="sub">2020-2026 年度变化</div></div>
      <div class="salary-grid">
        <div class="salary-stat"><div class="sl">月薪范围</div><div class="sv">${(sd.monthly_min/1000).toFixed(1)}k<small> - ${(sd.monthly_max/1000).toFixed(1)}k</small></div></div>
        <div class="salary-stat"><div class="sl">月薪中位</div><div class="sv">${(sd.monthly_median/1000).toFixed(1)}k</div></div>
        <div class="salary-stat"><div class="sl">年薪范围</div><div class="sv">${(sd.annual_min/10000).toFixed(1)}w<small> - ${(sd.annual_max/10000).toFixed(1)}w</small></div></div>
        <div class="salary-stat"><div class="sl">7年增长</div><div class="sv">${growth > 0 ? '+' : ''}${growth}%</div><div class="delta ${growth > 0 ? 'up' : 'down'}">${growth > 0 ? '↑' : '↓'} ${Math.abs(growth)}%</div></div>
      </div>
      <div class="salary-chart">
        <div class="chart-title">📊 年度薪资趋势（月薪中位数）</div>
        <div class="salary-bars">${bars}</div>
      </div>
      <div class="salary-demand">
        <span class="dl">市场需求：</span>
        <span class="tag ${demandTag}">${demandText}</span>
        <span class="dl" style="margin-left:12px">年均增长率：</span>
        <span class="tag blue">${esc(sd.growth_rate)}</span>
        <span class="dl" style="margin-left:auto;font-size:11px;color:var(--c-tx-3)">数据基于行业基准模型估算，实际薪资受城市、经验、企业规模影响</span>
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

// ================================================================== 统计分析
function pageAnalytics(c) {
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

  // 门类分布
  const catMap = {};
  for (const ind of inds) {
    const cat = ind['行业门类'] || '其他';
    if (!catMap[cat]) catMap[cat] = { count: 0, codes: [] };
    catMap[cat].count++;
    catMap[cat].codes.push(ind['行业编号']);
  }
  const cats = Object.entries(catMap).sort((a, b) => b[1].count - a[1].count);
  const catMax = cats.length ? cats[0][1].count : 1;

  // 风险层级分布
  const lvMap = {};
  for (const r of risks) {
    const lv = r['风险层级'] || '未分级';
    lvMap[lv] = (lvMap[lv] || 0) + 1;
  }
  const lvTotal = Object.values(lvMap).reduce((a, b) => a + b, 0) || 1;

  // 城市风险集中度
  const cityRiskMap = {};
  for (const r of risks) {
    const cn = r['城市'];
    if (!cityRiskMap[cn]) cityRiskMap[cn] = { total: 0, high: 0, mid: 0, low: 0 };
    cityRiskMap[cn].total++;
    const lv = r['风险层级'] || '';
    if (lv.startsWith('D') || lv.startsWith('E') || lv.startsWith('C-D')) cityRiskMap[cn].high++;
    else if (lv.startsWith('C')) cityRiskMap[cn].mid++;
    else cityRiskMap[cn].low++;
  }
  const cityRows = Object.entries(cityRiskMap).sort((a, b) => b[1].high - a[1].high);
  const cMax = Math.max(1, ...cityRows.map(x => x[1].total));

  // 行业风险指数
  const indRisk = [];
  const lvScore = { 'A': 1, 'B': 2, 'B-C': 2.5, 'C': 3, 'C-D': 3.5, 'D': 4, 'D-E': 4.5, 'E': 5 };
  for (const ind of inds) {
    const code = ind['行业编号'];
    const indRisks = risks.filter(r => r['行业编号'] === code);
    if (!indRisks.length) continue;
    let sum = 0, maxCity = '';
    let maxScore = 0;
    for (const r of indRisks) {
      const lv = (r['风险层级'] || '').replace(/级·.*$/, '').replace(/风险|中低|中高|中等/g, '').trim();
      const sc = lvScore[lv] || 3;
      sum += sc;
      if (sc > maxScore) { maxScore = sc; maxCity = r['城市']; }
    }
    indRisk.push({ ...ind, 风险指数: +(sum / indRisks.length).toFixed(2), 最高风险城市: maxCity });
  }
  indRisk.sort((a, b) => b.风险指数 - a.风险指数);
  const topRisk = indRisk.slice(0, 20);
  const bestRisk = indRisk.slice(-15).reverse();

  // 薪资分析
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

  // 职业需求分布
  const demandMap = { '高': 0, '中': 0, '低': 0 };
  for (const s of salaryStats) {
    demandMap[s.demand] = (demandMap[s.demand] || 0) + 1;
  }

  c.innerHTML = `
  <div class="stat-grid fade-in">
    <div class="stat"><div class="n">${t.行业}</div><div class="l">细分行业</div></div>
    <div class="stat g"><div class="n">${t.门类}</div><div class="l">行业门类</div></div>
    <div class="stat"><div class="n">${t.职业}</div><div class="l">岗位核实明细</div></div>
    <div class="stat g"><div class="n">${t.经营模式}</div><div class="l">经营模式条目</div></div>
    <div class="stat o"><div class="n">${t.城市}</div><div class="l">覆盖城市</div></div>
    <div class="stat r"><div class="n">${t.城市风险记录}</div><div class="l">行业×城市 分级记录</div></div>
  </div>

  <div class="card fade-in">${cardHead('A', '行业门类分布', `${t.行业} 个细分行业 / ${t.门类} 个门类`)}
    <div class="card-bd"><div class="bars">
      ${cats.map(([n, v]) => `<div class="bar-row">
        <div class="bl" title="${esc(v.codes.join('、'))}">${esc(n)}</div>
        <div class="bt"><div class="bf" style="width:${(v.count / catMax * 100).toFixed(1)}%"></div></div>
        <div class="bv">${v.count}</div></div>`).join('')}
    </div></div></div>

  <div class="card fade-in">${cardHead('B', '全库风险层级分布', 'A 低 → E 高')}
    <div class="card-bd"><div class="bars">
      ${Object.entries(lvMap).sort((a, b) => b[1] - a[1]).map(([n, v]) => `<div class="bar-row ${/^[DE]/.test(n) ? 'red' : /^C-D/.test(n) ? 'orange' : /^C/.test(n) ? 'gold' : 'green'}">
        <div class="bl">${esc(n)}</div>
        <div class="bt"><div class="bf" style="width:${(v / lvTotal * 100).toFixed(1)}%"></div></div>
        <div class="bv">${v} <small style="color:#94a3b8;font-weight:400">${(v / lvTotal * 100).toFixed(1)}%</small></div></div>`).join('')}
    </div></div></div>

  <div class="card fade-in">${cardHead('C', '城市风险集中度', '按高风险记录数排序')}
    <div class="card-bd"><div class="bars">
      ${cityRows.map(([cn, m]) => `<div class="bar-row ${m.high / m.total > .45 ? 'red' : m.high / m.total > .3 ? 'orange' : 'gold'}">
        <div class="bl">${esc(cn)}</div>
        <div class="bt"><div class="bf" style="width:${(m.total / cMax * 100).toFixed(1)}%"></div></div>
        <div class="bv" title="高/中高 ${m.high}｜中等 ${m.mid}｜低 ${m.low}">${m.high}<small style="color:#94a3b8;font-weight:400">/${m.total}</small></div></div>`).join('')}
    </div>
    <p class="hint" style="margin-top:10px">条形长度＝该城市全部行业记录数；数字＝「高风险」/「总数」</p>
    </div></div>

  <div class="card fade-in">${cardHead('D', '行业风险热力矩阵', `${t.行业} 行业 × ${t.城市} 城市 · 点击单元格跳转看板`)}
    <div class="card-bd"><div class="heat-wrap" id="heatWrap"></div>
      <div class="legend">
        <span><i class="hc-A"></i>A 低</span><span><i class="hc-BC"></i>B/B-C</span>
        <span><i class="hc-C"></i>C 中等</span><span><i class="hc-CD"></i>C-D 中高</span>
        <span><i class="hc-D"></i>D 中高</span><span><i class="hc-E"></i>E 高</span>
      </div>
    </div></div>

  <div class="card fade-in">${cardHead('E', '行业风险指数排行', '20城层级平均分（A=1→E=5，分值越高风险越大）')}
    <div class="card-bd">
      <div class="btn-row" style="margin-bottom:11px">
        <button class="btn sm on" data-rk="high">风险最高 TOP 20</button>
        <button class="btn sm" data-rk="low">风险最低 TOP 15</button>
      </div>
      <div id="rankBox"></div>
    </div></div>

  <div class="card fade-in">${cardHead('F', '职业薪资分布', `${salaryStats.length} 个职业的月薪中位数分布`)}
    <div class="card-bd"><div class="bars">
      ${Object.entries(salaryBins).map(([n, v]) => `<div class="bar-row ${n.includes('20k') || n.includes('12-20') ? 'green' : n.includes('8-12') ? '' : n.includes('5-8') ? 'gold' : n.includes('3-5') ? 'orange' : 'red'}">
        <div class="bl">${esc(n)}</div>
        <div class="bt"><div class="bf" style="width:${(v / sMax * 100).toFixed(1)}%"></div></div>
        <div class="bv">${v}</div></div>`).join('')}
    </div>
    <p class="hint" style="margin-top:10px">基于行业基准模型估算，含各城市调整系数</p>
    </div></div>

  <div class="card fade-in">${cardHead('G', '职业市场需求热度', '高/中/低三档需求分布')}
    <div class="card-bd"><div class="bars">
      ${Object.entries(demandMap).map(([n, v]) => `<div class="bar-row ${n === '高' ? 'red' : n === '中' ? 'gold' : 'green'}">
        <div class="bl">${n === '高' ? '需求旺盛' : n === '中' ? '需求稳定' : '需求一般'}</div>
        <div class="bt"><div class="bf" style="width:${(v / Math.max(1, salaryStats.length) * 100).toFixed(1)}%"></div></div>
        <div class="bv">${v} <small style="color:#94a3b8;font-weight:400">${(v / Math.max(1, salaryStats.length) * 100).toFixed(1)}%</small></div></div>`).join('')}
    </div></div></div>

  <div class="card fade-in">${cardHead('H', '数据覆盖完整性', '逐行业核对职业/经营模式/城市风险是否齐全')}
    <div class="card-bd" id="covBox"></div></div>
  `;

  // 热力矩阵
  (function() {
    const cityNames = cities.map(x => x['城市名称']);
    const riskByInd = new Map();
    for (const r of risks) {
      if (!riskByInd.has(r['行业编号'])) riskByInd.set(r['行业编号'], new Map());
      riskByInd.get(r['行业编号']).set(r['城市'], r['风险层级']);
    }
    let h = '<table class="heat"><thead><tr><th style="left:0;z-index:4;background:#f8fafc">行业</th>'
      + cityNames.map(n => `<th>${esc(n)}</th>`).join('') + '</tr></thead><tbody>';
    for (const a of indRisk) {
      const m = riskByInd.get(a['行业编号']) || new Map();
      h += `<tr><td class="rowh" title="${esc(a['行业编号'] + ' ' + a['细分行业'])}">${esc(a['行业编号'])} ${esc(a['细分行业'])}</td>`
        + cityNames.map(cn => {
          const v = m.get(cn) || '';
          const short = String(v).replace('级·', '').replace(/风险|中低|中高|中等/g, '');
          return `<td class="c ${heatClass(v)}" data-i="${esc(a['行业编号'])}" data-c="${esc(cn)}" title="${esc(a['行业编号'] + ' · ' + cn + '：' + v)}">${esc(short)}</td>`;
        }).join('') + '</tr>';
    }
    h += '</tbody></table>';
    $('#heatWrap').innerHTML = h;
    $$('#heatWrap td.c').forEach(td => {
      td.onclick = () => {
        S.dash = { industry: td.dataset.i, job: '', city: td.dataset.c, ci: new Set([td.dataset.i]), cj: new Set(), cc: new Set([td.dataset.c]), queried: true };
        go('dashboard');
      };
    });
  })();

  // 排行
  const renderRank = (mode) => {
    const list = mode === 'high' ? topRisk : bestRisk;
    const mx = Math.max(...list.map(x => x.风险指数 || 0), 1);
    $('#rankBox').innerHTML = `<div class="bars">${list.map(x => `<div class="bar-row ${x.风险指数 >= 4 ? 'red' : x.风险指数 >= 3 ? 'orange' : x.风险指数 >= 2 ? 'gold' : 'green'}">
      <div class="bl" style="cursor:pointer" title="点击跳转看板">${esc(x['行业编号'])} ${esc(x['细分行业'])}</div>
      <div class="bt"><div class="bf" style="width:${(x.风险指数 / mx * 100).toFixed(1)}%"></div></div>
      <div class="bv">${x.风险指数} <small style="color:#94a3b8;font-weight:400">${esc(x['最高风险城市'] || '')}</small></div></div>`).join('')}</div>`;
    $$('#rankBox .bar-row .bl').forEach((el, i) => {
      el.onclick = () => {
        S.dash = { industry: list[i]['行业编号'], job: '', city: '', ci: new Set([list[i]['行业编号']]), cj: new Set(), cc: new Set(), queried: true };
        go('dashboard');
      };
    });
  };
  renderRank('high');
  $$('[data-rk]').forEach(b => { b.onclick = () => { $$('[data-rk]').forEach(x => x.classList.remove('on')); b.classList.add('on'); renderRank(b.dataset.rk); }; });

  // 覆盖完整性
  const cov = inds.map(ind => {
    const code = ind['行业编号'];
    return {
      '行业编号': code, '细分行业': ind['细分行业'],
      职业数: jobs.filter(j => j['行业编号'] === code).length,
      模式数: modes.filter(m => m['行业编号'] === code).length,
      城市风险数: risks.filter(r => r['行业编号'] === code).length,
    };
  });
  const bad = cov.filter(x => x.职业数 === 0 || x.模式数 === 0 || x.城市风险数 !== t.城市);
  $('#covBox').innerHTML = `
    <div class="stat-grid" style="margin-bottom:12px">
      <div class="stat g"><div class="n">${cov.filter(x => x.职业数 > 0).length}/${cov.length}</div><div class="l">有职业数据的行业</div></div>
      <div class="stat g"><div class="n">${cov.filter(x => x.模式数 > 0).length}/${cov.length}</div><div class="l">有经营模式的行业</div></div>
      <div class="stat ${bad.length ? 'r' : 'g'}"><div class="n">${cov.length - bad.length}/${cov.length}</div><div class="l">三项全齐的行业</div></div>
      <div class="stat"><div class="n">${t.职业}</div><div class="l">职业明细总条数</div></div>
    </div>
    ${bad.length
      ? `<p class="hint" style="margin-bottom:8px;color:#dc2626">以下 ${bad.length} 个行业存在数据缺口：</p>
         <div class="tbl-wrap" style="max-height:260px"><table class="tbl"><thead><tr>
           <th>行业编号</th><th>细分行业</th><th>职业数</th><th>模式数</th><th>城市风险数</th></tr></thead>
           <tbody>${bad.map(x => `<tr><td class="code">${esc(x['行业编号'])}</td><td>${esc(x['细分行业'])}</td>
             <td>${x.职业数 === 0 ? '<span class="tag red">缺</span>' : x.职业数}</td>
             <td>${x.模式数 === 0 ? '<span class="tag red">缺</span>' : x.模式数}</td>
             <td>${x.城市风险数 !== t.城市 ? `<span class="tag gold">${x.城市风险数}/${t.城市}</span>` : x.城市风险数}</td></tr>`).join('')}</tbody></table></div>`
      : '<p class="hint" style="color:#059669">✓ 全部行业的职业、经营模式、城市风险三项数据均齐全，无缺口。</p>'}
  `;
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

    <div class="card fade-in">${cardHead('🔄', '数据自动更新机制', '通过 GitHub Actions 定期抓取和更新数据')}
      <div class="card-bd">
        <p class="hint" style="margin-bottom:14px">本知识库支持通过 GitHub Actions 定时任务自动抓取和更新职业薪资数据。更新流程如下：</p>
        <div class="bars">
          <div class="bar-row"><div class="bl" style="width:140px;text-align:left">① 定时触发</div><div class="bt"><div class="bf" style="width:100%"></div></div><div class="bv">每周一 06:00</div></div>
          <div class="bar-row gold"><div class="bl" style="width:140px;text-align:left">② 数据抓取</div><div class="bt"><div class="bf" style="width:100%"></div></div><div class="bv">公开数据源</div></div>
          <div class="bar-row green"><div class="bl" style="width:140px;text-align:left">③ 数据合并</div><div class="bt"><div class="bf" style="width:100%"></div></div><div class="bv">增量更新</div></div>
          <div class="bar-row"><div class="bl" style="width:140px;text-align:left">④ 自动部署</div><div class="bt"><div class="bf" style="width:100%"></div></div><div class="bv">GitHub Pages</div></div>
        </div>
        <div style="margin-top:14px;padding:12px 14px;background:#f8fafc;border-radius:8px;border-left:3px solid var(--c-brand)">
          <p class="hint" style="margin:0">当前数据版本：<b>${lastUpdate}</b><br>
          数据来源：小微行业知识库看板V3.xlsx + 薪资基准模型估算<br>
          如需手动更新数据，请在 GitHub 仓库 <code style="background:#e2e8f0;padding:2px 6px;border-radius:4px">gaoyuxinba/xwk-knowledge-base</code> 的 Actions 页面手动触发工作流。</p>
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

    <div class="card fade-in">${cardHead('💡', '数据补充建议', '可扩展的数据维度和来源')}
      <div class="card-bd">
        <div class="bars">
          <div class="bar-row green"><div class="bl" style="width:180px;text-align:left">招聘平台薪资</div><div class="bt"><div class="bf" style="width:85%"></div></div><div class="bv">Boss直聘/智联</div></div>
          <div class="bar-row green"><div class="bl" style="width:180px;text-align:left">政府统计数据</div><div class="bt"><div class="bf" style="width:70%"></div></div><div class="bv">统计局/人社局</div></div>
          <div class="bar-row gold"><div class="bl" style="width:180px;text-align:left">行业报告</div><div class="bt"><div class="bf" style="width:60%"></div></div><div class="bv">研究院/协会</div></div>
          <div class="bar-row gold"><div class="bl" style="width:180px;text-align:left">企业招聘信息</div><div class="bt"><div class="bf" style="width:50%"></div></div><div class="bv">天眼查/企查查</div></div>
          <div class="bar-row"><div class="bl" style="width:180px;text-align:left">职业培训信息</div><div class="bt"><div class="bf" style="width:40%"></div></div><div class="bv">培训机构</div></div>
        </div>
        <p class="hint" style="margin-top:12px">以上数据源均可通过 GitHub Actions 定时抓取脚本自动获取并合并到知识库中，持续丰富职业和行业信息。</p>
      </div>
    </div>
  `;
}

// ================================================================== 页面注册
const PAGES = {
  dashboard: pageDashboard,
  analytics: pageAnalytics,
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
