/* ============================================================
   小微行业知识库看板 V3 · Web 版 前端
   看板区块与筛选逻辑严格对齐 Excel：
     01 行业档案 / 02 经营模式 / 03 前景利润淡旺季
     04 在职客户岗位核实（字段名：审核时怎么问）
     05 城市风险分级（A低→E高，最多8行）
   ============================================================ */
'use strict';

// ------------------------------------------------------------------ 状态
const S = {
  token: localStorage.getItem('xwk_token') || '',
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

// ------------------------------------------------------------------ API
// API 基础地址：如果页面是从 GitHub Pages 等静态托管打开的，就用 FC 的后端地址
const API_BASE = (function() {
  // 优先用全局配置（可在 index.html 里设置 window.__API_BASE__）
  if (typeof window !== 'undefined' && window.__API_BASE__) return window.__API_BASE__;
  // 如果是 file:// 协议，用默认 FC 地址
  if (typeof location !== 'undefined' && location.protocol === 'file:') {
    return 'https://xwk-app-svc-bdc-ezsbwsqoap.cn-shanghai.fcapp.run';
  }
  // 如果域名是 github.io 或者 vercel.app 等静态托管，用 FC 地址
  if (typeof location !== 'undefined' && 
      (location.hostname.endsWith('github.io') || 
       location.hostname.endsWith('vercel.app') ||
       location.hostname.endsWith('netlify.app') ||
       location.hostname.endsWith('pages.dev'))) {
    return 'https://xwk-app-svc-bdc-ezsbwsqoap.cn-shanghai.fcapp.run';
  }
  // 否则用相对路径（同域部署）
  return '';
})();

async function api(path, opt) {
  opt = opt || {};
  const headers = { 'Content-Type': 'application/json' };
  if (S.token) headers.Authorization = 'Bearer ' + S.token;
  const url = API_BASE + path;
  
  // 最多重试 2 次（共 3 次尝试）
  const maxRetries = opt.noRetry ? 0 : 2;
  let lastError = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      await new Promise(r => setTimeout(r, 300 * attempt));
    }
    
    try {
      const res = await fetch(url, { method: opt.method || 'GET', headers, body: opt.body ? JSON.stringify(opt.body) : undefined });
      
      if (res.status === 401) {
        if (S.user) { toast('登录已失效', '请重新登录', 'err'); doLogout(false); }
        throw new Error('未登录');
      }
      
      const ct = res.headers.get('content-type') || '';
      let data;
      try {
        data = ct.includes('application/json') ? await res.json() : await res.text();
      } catch(e) {
        data = { error: '响应解析失败' };
      }
      
      if (!res.ok || (data && data.ok === false)) {
        const errMsg = (data && data.error) || ('请求失败 ' + res.status);
        const fullMsg = errMsg + ' (' + path + ')';
        
        // 400、5xx、网络错误都重试（可能是偶发的）
        const shouldRetry = (res.status === 400 || res.status >= 500) && attempt < maxRetries;
        if (shouldRetry) {
          lastError = new Error(fullMsg);
          continue;
        }
        
        throw new Error(fullMsg);
      }
      return data;
    } catch (e) {
      lastError = e;
      // 网络错误重试
      const isNetworkError = e.message && (
        e.message.includes('网络请求失败') ||
        e.message.includes('Failed to fetch') ||
        e.message.includes('NetworkError') ||
        e.message.includes('timeout') ||
        e.name === 'TypeError'
      );
      if ((isNetworkError && attempt < maxRetries) || 
          (e.message && e.message.includes('400') && attempt < maxRetries)) {
        continue;
      }
      throw e;
    }
  }
  
  throw lastError || new Error('请求失败');
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
// 看板上的显示名（与 Excel 一致）
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
  { g: '系统管理', items: [
    { id: 'admin_users', ico: '🔐', t: '账号与权限', manage: true },
    { id: 'admin_logs', ico: '🛰', t: '登录与操作日志', manage: true },
    { id: 'admin_sys', ico: '⚙️', t: '系统自检与设置', manage: true },
  ]},
];

function renderNav() {
  const nav = $('#nav');
  let h = '';
  for (const g of NAV) {
    const items = g.items.filter((i) => !i.manage || (S.user && S.user.can_manage));
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
  admin_users: '账号与权限管理', admin_logs: '登录与操作日志', admin_sys: '系统自检与设置',
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
  // 状态栏（复刻看板 A4：行业 ｜ 职业 ｜ 城市）
  $('#statusLine').innerHTML =
    `行业：<b>${esc(d.status.industry)}</b><span class="sep">｜</span>` +
    `职业：<b>${esc(d.status.job)}</b><span class="sep">｜</span>` +
    `城市：<b>${esc(d.status.city)}</b>`;

  // 识别编号 / 行业名称 / 行业门类（复刻看板 B3/E3/H3）
  const ind = d.industry;
  $('#idBox').innerHTML = ind ? `
    <div><div class="k">识别编号</div><div class="v code">${esc(ind['行业编号'])}</div></div>
    <div><div class="k">行业名称</div><div class="v">${esc(ind['细分行业'])}</div></div>
    <div><div class="k">行业门类</div><div class="v">${esc(ind['行业门类'])}</div></div>
    <div><div class="k">职业 / 经营模式 / 城市</div><div class="v">${d.jobs.total} / ${d.modes.length} / ${d.cities.shownCount}</div></div>
  ` : `<div><div class="k">识别编号</div><div class="v" style="color:#8a95a5">未定位</div></div>
      <div><div class="k">提示</div><div class="v" style="font-size:13px;font-weight:400;color:#5b6879">
        ${esc(d.status.industry)}</div></div>`;

  // ① 行业候选 chips
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
      // 单选语义：与 Excel「勾选前4取第一个命中」一致，这里锁定单个
      [...q.ci].forEach((x) => { if (x !== code) q.ci.delete(x); });
      q.industry = el.dataset.label;
      $('#qInd').value = q.industry;
      loadDash();
    };
  });

  // ② 职业 chips
  const jq = $('#qJob');
  jq.disabled = !d.resolvedCode;
  $('#mJob').innerHTML = d.resolvedCode
    ? `本行业 <b>${d.jobs.total}</b> 个职位｜命中 <b>${d.jobs.hit}</b>｜显示 <b>${d.jobs.shownCount}</b>${d.jobs.shownCount > 10 ? '（看板最多 10）' : ''}`
    : '请先选定行业';
  $('#chJob').innerHTML = d.resolvedCode
    ? d.jobs.all.map((r) => {
        const on = q.cj.has(r['常见职位']);
        const dim = !r['命中'];
        return `<span class="chip${on ? ' on' : ''}${dim ? ' dim' : ''}" data-j="${esc(r['常见职位'])}" title="${esc(r['三段式标签'])}">${esc(r['常见职位'])}</span>`;
      }).join('') || '<span class="hint">该行业暂无职位</span>'
    : '<span class="hint">—</span>';
  $$('#chJob .chip').forEach((el) => {
    el.onclick = () => {
      const jn = el.dataset.j;
      if (q.cj.has(jn)) q.cj.delete(jn); else q.cj.add(jn);
      loadDash();
    };
  });

  // ③ 城市 chips
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

  // 主体区块
  $('#dashBody').innerHTML =
    sec01(d) + sec02(d) + sec03(d) + sec04(d) + sec05(d);
  bindEdits($('#dashBody'));
  bindModeToggles($('#dashBody'));
}

function cardHead(no, title, sub) {
  return `<div class="card-hd"><h3><span class="no">${no}</span>${esc(title)}</h3>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;
}

function kvRows(rec, fields, collection, recKey) {
  const canEd = S.user && S.user.can_edit;
  return fields.map((f) => {
    const v = rec[f] == null ? '' : rec[f];
    return `<tr><th>${esc(lb(f))}</th><td>${cellHtml(collection, recKey, f, v, canEd)}</td></tr>`;
  }).join('');
}

function cellHtml(collection, recKey, field, value, canEdit) {
  const empty = !String(value || '').trim() || String(value).trim() === '—';
  const txt = empty ? '<span style="color:#a9b3c2">—</span>' : nl2br(value);
  if (!canEdit) return `<div class="txt">${txt}</div>`;
  return `<div class="cell-ed"><div class="txt">${txt}</div>
    <button class="btn sm ed-btn" data-c="${esc(collection)}" data-k="${esc(recKey)}" data-f="${esc(field)}" title="编辑此字段">✎</button></div>`;
}

function sec01(d) {
  if (!d.industry) return '';
  const k = d.industry['行业编号'];
  return `<div class="card">${cardHead('01', '行业档案', `${esc(d.industry['行业门类'])} · ${esc(k)}`)}
    <div class="card-bd tight"><table class="kv">${kvRows(d.industry, F.industries_01, 'industries', k)}</table></div></div>`;
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
        <div class="grp-bd"><table class="kv">${kvRows(m, F.modes_02, 'modes', k)}</table></div></div>`;
    }).join('')}</div>`;
  }
  return `<div class="card">${cardHead('02', '经营模式', `共 ${modes.length} 条${modes.length > 1 ? '（按 ◆模式名 分组）' : ''}`)}
    <div class="card-bd">${bd}</div></div>`;
}

function sec03(d) {
  if (!d.industry) return '';
  const k = d.industry['行业编号'];
  const ind = d.industry;
  // 毛利/净利、旺季/淡季 成对展示（对齐 Excel 看板 E24/F24、E25/F25）
  const pair = (f1, f2) => `<tr><th>${esc(lb(f1))}</th>
    <td style="width:44%">${cellHtml('industries', k, f1, ind[f1], S.user && S.user.can_edit)}</td>
    <th style="width:96px">${esc(lb(f2))}</th>
    <td>${cellHtml('industries', k, f2, ind[f2], S.user && S.user.can_edit)}</td></tr>`;
  const single = (f) => `<tr><th>${esc(lb(f))}</th><td colspan="3">${cellHtml('industries', k, f, ind[f], S.user && S.user.can_edit)}</td></tr>`;
  return `<div class="card">${cardHead('03', '前景 、利润 、淡旺季', '含毛利率 / 净利率 / 旺淡季')}
    <div class="card-bd tight"><table class="kv">
      ${single('前景趋势判断')}
      ${pair('毛利率区间', '净利率区间')}
      ${pair('旺季月份', '淡季月份')}
      ${single('季节性资金缺口高峰')}${single('主要经营风险')}${single('政策与外部驱动')}
    </table></div></div>`;
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
        <div class="grp-bd"><table class="kv">${kvRows(j, F.jobs_04, 'jobs', k)}</table></div></div>`;
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

// ------------------------------------------------------------------ 内联编辑
function bindEdits(root) {
  $$('.ed-btn', root).forEach((b) => {
    b.onclick = () => openEditor(b.dataset.c, b.dataset.k, b.dataset.f);
  });
}

async function openEditor(collection, recKey, field) {
  let cur = null;
  const d = S.dashData;
  if (d) {
    const pools = {
      industries: d.industry ? [d.industry] : [],
      modes: d.modes || [],
      jobs: (d.jobs.all || []).map((r) => r['明细']),
      city_risks: [],
    };
    cur = (pools[collection] || []).find((r) => keyOf(collection, r) === recKey) || null;
  }
  const val = cur ? (cur[field] == null ? '' : cur[field]) : '';
  modal(`编辑 · ${lb(field)}`, `
    <div class="fld"><span>记录</span><input type="text" value="${esc(recKey)}" disabled></div>
    <div class="fld"><span>${esc(lb(field))}</span>
      <textarea id="edVal" rows="10" style="width:100%;padding:10px 13px;border:1px solid var(--c-line);border-radius:6px;line-height:1.75">${esc(val)}</textarea>
    </div>
    <p class="hint">修改会写入覆盖层并记录操作人、时间与来源 IP，原始 Excel 数据保留不动，可随时「还原为原始值」。</p>
  `, `<button class="btn" id="edRevert">还原为原始值</button>
      <button class="btn" id="edCancel">取消</button>
      <button class="btn green" id="edSave">保存</button>`);
  $('#edCancel').onclick = closeModal;
  $('#edSave').onclick = async () => {
    const nv = $('#edVal').value;
    try {
      const r = await api(`/api/collection/${collection}/record`, { method: 'PUT', body: { rec_key: recKey, changes: { [field]: nv } } });
      toast('已保存', `更新 ${r.updated} 个字段`);
      closeModal();
      if (S.page === 'dashboard') loadDash(); else go(S.page);
    } catch (e) { toast('保存失败', e.message, 'err'); }
  };
  $('#edRevert').onclick = async () => {
    if (!confirm('确定还原这条记录的全部字段为 Excel 原始值？')) return;
    try {
      await api(`/api/collection/${collection}/record/revert`, { method: 'POST', body: { rec_key: recKey } });
      toast('已还原', '该记录已恢复为 Excel 原始数据');
      closeModal();
      if (S.page === 'dashboard') loadDash(); else go(S.page);
    } catch (e) { toast('还原失败', e.message, 'err'); }
  };
  setTimeout(() => $('#edVal').focus(), 40);
}

function keyOf(collection, r) {
  if (collection === 'industries') return r['行业编号'];
  if (collection === 'modes') return r['行业编号'] + '|' + r['细分模式'];
  if (collection === 'jobs') return r['行业编号'] + '|' + r['常见职位'];
  if (collection === 'city_risks') return r['行业编号'] + '|' + r['城市'];
  if (collection === 'cities') return r['城市名称'];
  return '';
}

function bindModeToggles(root) {
  $$('.grp-hd', root).forEach((h) => {
    h.style.cursor = 'pointer';
    h.onclick = (e) => {
      if (e.target.closest('.ed-btn')) return;
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
  const st = { page: 1, size: cfg.size || 50, q: '', code: '', total: 0 };
  const tb = $('#tb');

  tb.innerHTML = `
    <input type="text" id="fQ" placeholder="关键词全文检索…">
    ${cfg.codeFilter ? `<select id="fCode"><option value="">全部${cfg.codeFilterLabel || '行业'}</option></select>` : ''}
    <span class="sp"></span>
    <span class="hint" id="cnt"></span>
    ${cfg.allowAdd && S.user.can_edit ? '<button class="btn green" id="bAdd">＋ 新增记录</button>' : ''}
    <button class="btn" id="bExp">⬇ 导出本页数据</button>
  `;
  const reload = async () => {
    const p = new URLSearchParams({ page: st.page, size: st.size });
    if (st.q) p.set('q', st.q);
    if (st.code) p.set('code', st.code);
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
    $('#tw').innerHTML = `<table class="tbl"><thead><tr>${cols.map((x) => `<th>${esc(x.t)}</th>`).join('')}
      ${S.user.can_edit ? '<th>操作</th>' : ''}</tr></thead>
      <tbody>${rows.map((r) => {
        const k = keyOf(cfg.name, r);
        return `<tr>${cols.map((x) => {
          const v = x.f ? x.f(r) : r[x.k];
          if (x.cls === 'lv') return `<td><span class="lv ${lvClass(v)}">${esc(v || '—')}</span></td>`;
          if (x.cls === 'code') return `<td class="code">${esc(v || '')}</td>`;
          return `<td class="${x.wrap === false ? '' : 'wrap'}">${x.raw ? v : nl2br(v)}</td>`;
        }).join('')}
        ${S.user.can_edit ? `<td class="rowact">
          <button class="btn sm act-ed" data-k="${esc(k)}">编辑</button>
          ${cfg.allowDelete ? `<button class="btn sm danger act-del" data-k="${esc(k)}">删除</button>` : ''}
        </td>` : ''}</tr>`;
      }).join('')}</tbody></table>`;
    $$('.act-ed', $('#tw')).forEach((b) => { b.onclick = () => openRecordEditor(cfg, b.dataset.k, rows.find((r) => keyOf(cfg.name, r) === b.dataset.k)); });
    $$('.act-del', $('#tw')).forEach((b) => { b.onclick = () => delRecord(cfg, b.dataset.k); });
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

  if (cfg.codeFilter) {
    const sel = $('#fCode');
    const list = cfg.codeFilter === 'industry' ? (S.meta ? Object.keys(S.meta.categories || {}) : []) : [];
    if (cfg.codeFilter === 'industry') {
      // 用门类填充
      sel.innerHTML = '<option value="">全部门类</option>' + list.map((x) => `<option value="${esc(x)}">${esc(x)}</option>`).join('');
      sel.onchange = (e) => { st.q = e.target.value ? e.target.value + ' ' + $('#fQ').value.trim() : $('#fQ').value.trim(); st.q = st.q.trim(); st.page = 1; reload(); };
    } else {
      sel.remove();
    }
  }
  $('#fQ').oninput = debounce((e) => { st.q = e.target.value.trim(); st.page = 1; reload(); }, 280);
  const bExp = $('#bExp');
  if (bExp) bExp.onclick = () => downloadJson(cfg.name);
  const bAdd = $('#bAdd');
  if (bAdd) bAdd.onclick = () => openRecordEditor(cfg, null, null);
  await reload();
}

function openRecordEditor(cfg, recKey, rec) {
  const isNew = !rec;
  const fields = cfg.editFields || cfg.columns.filter((x) => !x.noEdit).map((x) => x.k);
  const tpl = rec || {};
  const body = `<div class="form-grid">${fields.map((f) => {
    const v = tpl[f] == null ? '' : tpl[f];
    const keyField = cfg.keyFields && cfg.keyFields.includes(f);
    const long = String(v).length > 40 || ['依据与尽调要点', '这个岗位每天干什么', '审核时怎么问', '能查到哪些证据',
      '真干过的人怎么答', '没干过的破绽', '主要经营风险', '政策与外部驱动', '前景趋势判断', '季节性资金缺口高峰',
      '运作方式', '盈利逻辑', '上下游与结算回款方式', '授信关注要点', '典型经营主体形态', '必备证照资质',
      '订单与客户来源', '定位标签', '职业标签串'].includes(f);
    return `<div class="fld${long ? ' full' : ''}">
      <span>${esc(lb(f))}${keyField ? ' <b style="color:#c0392b">*</b>' : ''}${(!isNew && keyField) ? ' <small style="color:#8a95a5">（关键字段不可改）</small>' : ''}</span>
      ${long
        ? `<textarea rows="4" data-f="${esc(f)}" style="width:100%;padding:9px 12px;border:1px solid var(--c-line);border-radius:6px;line-height:1.7" ${(!isNew && keyField) ? 'disabled' : ''}>${esc(v)}</textarea>`
        : `<input type="text" data-f="${esc(f)}" value="${esc(v)}" style="width:100%;padding:8px 11px;border:1px solid var(--c-line);border-radius:6px" ${(!isNew && keyField) ? 'disabled' : ''}>`}
    </div>`;
  }).join('')}</div>
  ${isNew ? '<p class="hint">带 <b style="color:#c0392b">*</b> 的字段用于生成记录唯一标识，请填写完整。</p>'
          : '<p class="hint">修改会写入覆盖层并留痕，原始 Excel 数据保留不动。</p>'}`;
  modal((isNew ? '新增' : '编辑') + ' · ' + cfg.title, body,
    `<button class="btn" id="rCancel">取消</button><button class="btn green" id="rSave">保存</button>`, { wide: true });
  $('#rCancel').onclick = closeModal;
  $('#rSave').onclick = async () => {
    const rec2 = {};
    $$('#modalBody [data-f]').forEach((el) => { rec2[el.dataset.f] = el.value; });
    try {
      if (isNew) {
        const r = await api(`/api/collection/${cfg.name}/record`, { method: 'POST', body: { record: rec2 } });
        toast('已新增', r.key);
      } else {
        const changes = {};
        for (const [f, v] of Object.entries(rec2)) if (String(v) !== String(tpl[f] == null ? '' : tpl[f])) changes[f] = v;
        if (!Object.keys(changes).length) { toast('无变更', '内容没有修改'); closeModal(); return; }
        const r = await api(`/api/collection/${cfg.name}/record`, { method: 'PUT', body: { rec_key: recKey, changes } });
        toast('已保存', `更新 ${r.updated} 个字段`);
      }
      closeModal();
      await refreshMeta();
      go(S.page);
    } catch (e) { toast('保存失败', e.message, 'err'); }
  };
}

async function delRecord(cfg, recKey) {
  if (!confirm(`确定删除记录「${recKey}」？\n\n删除后可通过重新导入或还原恢复（原始 Excel 数据始终保留）。`)) return;
  try {
    await api(`/api/collection/${cfg.name}/record?rec_key=${encodeURIComponent(recKey)}`, { method: 'DELETE' });
    toast('已删除', recKey);
    await refreshMeta();
    go(S.page);
  } catch (e) { toast('删除失败', e.message, 'err'); }
}

async function downloadJson(name) {
  try {
    const res = await fetch('/api/export/' + name, { headers: { Authorization: 'Bearer ' + S.token } });
    if (!res.ok) throw new Error('导出失败 ' + res.status);
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `xwk_${name}_${Date.now()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('已开始下载', a.download);
  } catch (e) { toast('导出失败', e.message, 'err'); }
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
    keyFields: ['行业编号'], editFields: F.industries_all,
    allowAdd: true, allowDelete: true,
  });
}

function pageJobs(c) {
  return dataTablePage(c, {
    name: 'jobs', no: '04', title: '职业管理（在职客户岗位核实）',
    sub: `数据源 _m04 · 共 ${S.meta ? S.meta.job_count : 0} 条岗位明细`,
    columns: [
      COL_INDUSTRY,
      { t: '常见职位', k: '常见职位', wrap: false, f: (r) => `<b>${esc(r['常见职位'])}</b>` , raw: true },
      { t: '岗位每天干什么', k: '这个岗位每天干什么' },
      { t: '审核时怎么问', k: '审核时怎么问' },
      { t: '能查到哪些证据', k: '能查到哪些证据' },
      { t: '真干过的人怎么答', k: '真干过的人怎么答' },
      { t: '没干过的破绽', k: '没干过的破绽' },
      { t: '审批要点', k: '审批要点' },
    ],
    keyFields: ['行业编号', '常见职位'], editFields: F.jobs_all,
    allowAdd: true, allowDelete: true, size: 50,
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
    keyFields: ['行业编号', '城市'], editFields: F.risks_all,
    allowAdd: true, allowDelete: true, size: 50,
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
    keyFields: ['行业编号', '细分模式'], editFields: F.modes_all,
    allowAdd: true, allowDelete: true,
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

  // 门类分布
  const cats = Object.entries(d.categories).sort((a, b) => b[1].行业数 - a[1].行业数);
  const catMax = cats.length ? cats[0][1].行业数 : 1;

  // 城市风险
  const cityRows = Object.entries(d.riskByCity);
  const citySum = cityRows.map(([cn, m]) => ({
    cn, total: Object.values(m).reduce((a, b) => a + b, 0),
    high: (m['D级·中高风险'] || 0) + (m['E级·高风险'] || 0) + Object.entries(m).filter(([k]) => k.startsWith('C-D')).reduce((a, b) => a + b[1], 0),
    mid: m['C级·中等风险'] || 0,
    low: Object.entries(m).filter(([k]) => k.startsWith('A') || k.startsWith('B')).reduce((a, b) => a + b[1], 0),
    m,
  })).sort((a, b) => b.high - a.high);
  const cMax = Math.max(1, ...citySum.map((x) => x.total));

  // 行业风险 TOP
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

  // 热力矩阵（一次性拉取全部城市风险，前端建矩阵，避免 N 次串行请求）
  (async () => {
    let allRows;
    try {
      const r = await api('/api/collection/city_risks?size=3000');
      allRows = r.rows;
    } catch (e) {
      $('#heatWrap').innerHTML = `<div class="empty">${esc(e.message)}</div>`;
      return;
    }
    // 按 行业编号 → (城市 → 层级) 建索引
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

  // 排行
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

  // 覆盖完整性
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
  <div class="card">${cardHead('📤', '数据导出', '导出当前生效数据（含所有人工编辑）')}
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

  <div class="card">${cardHead('📥', '数据导入', S.user.can_edit ? '按记录唯一键增量合并（存在则更新、不存在则新增）' : '需要页面编辑权限')}
    <div class="card-bd">
      ${S.user.can_edit ? `
      <div class="toolbar">
        <select id="impTarget">
          <option value="industries">行业档案（键：行业编号）</option>
          <option value="modes">经营模式（键：行业编号 + 细分模式）</option>
          <option value="jobs">职业明细（键：行业编号 + 常见职位）</option>
          <option value="city_risks">城市风险（键：行业编号 + 城市）</option>
          <option value="cities">城市（键：城市名称）</option>
        </select>
        <input type="file" id="impFile" accept=".json,application/json" style="border:1px solid var(--c-line);border-radius:6px;padding:6px 10px">
        <span class="sp"></span>
        <button class="btn green" id="impBtn">开始导入</button>
      </div>
      <div id="impRes"></div>
      <p class="hint">文件格式：JSON 数组，或形如 <code>{"jobs":[...]}</code> 的对象。字段名需与导出文件一致。导入前建议先导出一份备份。</p>`
      : '<div class="empty"><span class="big">🔒</span>你的账号没有页面编辑权限，无法导入数据<br><small>请联系超级管理员授权</small></div>'}
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
        <tr><th>未采用</th><td><code>00_整合明细</code> 的职业信息（19 个行业明细全为「—」占位）、<code>05_行业分层框架</code>、
          <code>07_城市画像对比</code>、<code>城市档案·*</code>、<code>城市行业差异交叉表</code>（数据不新，按你的要求全部剔除）</td></tr>
      </table>
    </div></div>`;

  $$('[data-exp]').forEach((b) => { b.onclick = () => downloadJson(b.dataset.exp); });
  if (S.user.can_edit) {
    $('#impBtn').onclick = async () => {
      const f = $('#impFile').files[0];
      if (!f) { toast('请先选择文件', '', 'warn'); return; }
      const target = $('#impTarget').value;
      $('#impRes').innerHTML = '<div class="loading"><span class="spin"></span>解析并导入中…</div>';
      try {
        const txt = await f.text();
        let parsed = JSON.parse(txt);
        if (!Array.isArray(parsed)) {
          if (Array.isArray(parsed[target])) parsed = parsed[target];
          else if (parsed.jobs || parsed.industries || parsed.modes || parsed.city_risks || parsed.cities) {
            const k = Object.keys(parsed).find((x) => Array.isArray(parsed[x]) && x !== 'meta');
            if (k) { target === k || toast('提示', `文件内检测到 ${k}，已按 ${k} 导入`, 'warn'); parsed = parsed[k]; }
          }
        }
        if (!Array.isArray(parsed)) throw new Error('文件内容不是数组，无法识别');
        const r = await api('/api/import/' + target, { method: 'POST', body: parsed });
        $('#impRes').innerHTML = `<div class="statusline" style="margin-top:10px">导入完成：新增 <b>${r.added}</b> 条，更新 <b>${r.updated}</b> 条，跳过 <b>${r.skipped}</b> 条（关键字段为空）</div>`;
        toast('导入成功', `新增 ${r.added} / 更新 ${r.updated}`);
        await refreshMeta();
      } catch (e) {
        $('#impRes').innerHTML = `<div class="statusline" style="margin-top:10px;border-color:#f0c4c2;background:#fdf1f0;color:#a03028">导入失败：${esc(e.message)}</div>`;
        toast('导入失败', e.message, 'err');
      }
    };
  }
}

// ================================================================== 系统管理：账号与权限
const ROLE_NAME = { super_admin: '超级管理员', editor: '编辑人员', viewer: '浏览人员' };
const ROLE_TAG = { super_admin: 'red', editor: 'blue', viewer: 'gray' };

async function pageAdminUsers(c) {
  c.innerHTML = '<div class="loading"><span class="spin"></span>加载中…</div>';
  let users;
  try { users = (await api('/api/admin/users')).users; }
  catch (e) { c.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }

  c.innerHTML = `
  <div class="card">${cardHead('🔐', '账号与权限', `共 ${users.length} 个账号 · 仅超级管理员可管理`)}
    <div class="card-bd">
      <div class="toolbar">
        <button class="btn green" id="uAdd">＋ 新增账号</button>
        <span class="sp"></span>
        <span class="hint">权限说明：<b>浏览查看</b>＝可查询看板与数据；<b>页面编辑</b>＝可修改行业/职业/城市风险内容；<b>账号管理</b>＝仅超级管理员拥有，可增删账号与分配权限</span>
      </div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>ID</th><th>账号</th><th>姓名</th><th>角色</th><th>权限</th><th>状态</th><th>最近登录</th><th>登录 IP</th><th>备注</th><th>操作</th></tr></thead>
        <tbody>${users.map((u) => `<tr>
          <td>${u.id}</td>
          <td class="code">${esc(u.username)}${u.is_builtin ? ' <span class="tag gold" title="系统内置账号，不可删除/停用/降级">内置</span>' : ''}</td>
          <td>${esc(u.display_name || '')}</td>
          <td><span class="tag ${ROLE_TAG[u.role] || 'gray'}">${esc(ROLE_NAME[u.role] || u.role)}</span></td>
          <td><div class="perm-badges">
            ${u.can_view ? '<span class="tag green">浏览</span>' : ''}
            ${u.can_edit ? '<span class="tag blue">编辑</span>' : ''}
            ${u.can_manage ? '<span class="tag red">账号管理</span>' : ''}
          </div></td>
          <td>${u.enabled ? '<span class="tag green">启用</span>' : '<span class="tag red">停用</span>'}
              ${u.must_change ? '<span class="tag gold">待改密</span>' : ''}</td>
          <td class="nowrap">${u.last_login_at ? esc(fmt(u.last_login_at)) : '<span style="color:#a9b3c2">从未登录</span>'}</td>
          <td class="mono nowrap">${esc(u.last_login_ip || '—')}</td>
          <td class="wrap">${esc(u.remark || '')}</td>
          <td class="rowact nowrap">
            <button class="btn sm u-ed" data-id="${u.id}">${u.is_builtin ? '改密/资料' : '编辑'}</button>
            <button class="btn sm u-rs" data-id="${u.id}" data-u="${esc(u.username)}">重置密码</button>
            ${u.is_builtin ? '' : `<button class="btn sm ${u.enabled ? '' : 'green'} u-tg" data-id="${u.id}" data-en="${u.enabled ? 0 : 1}">${u.enabled ? '停用' : '启用'}</button>`}
            ${u.is_builtin ? '' : `<button class="btn sm danger u-del" data-id="${u.id}" data-u="${esc(u.username)}">删除</button>`}
          </td></tr>`).join('')}</tbody></table></div>
    </div></div>`;

  $('#uAdd').onclick = () => openUserEditor(null);
  $$('.u-ed').forEach((b) => { b.onclick = () => openUserEditor(users.find((u) => u.id === Number(b.dataset.id))); });
  $$('.u-rs').forEach((b) => { b.onclick = () => resetPwd(b.dataset.id, b.dataset.u); });
  $$('.u-tg').forEach((b) => { b.onclick = async () => {
    try { await api('/api/admin/users/' + b.dataset.id, { method: 'PUT', body: { enabled: b.dataset.en === '1' } });
      toast('已更新', b.dataset.en === '1' ? '账号已启用' : '账号已停用（其在线会话已强制下线）'); go('admin_users');
    } catch (e) { toast('操作失败', e.message, 'err'); }
  }; });
  $$('.u-del').forEach((b) => { b.onclick = async () => {
    if (!confirm(`确定删除账号「${b.dataset.u}」？该账号的登录会话将立即失效。`)) return;
    try { await api('/api/admin/users/' + b.dataset.id, { method: 'DELETE' }); toast('已删除', b.dataset.u); go('admin_users'); }
    catch (e) { toast('删除失败', e.message, 'err'); }
  }; });
}

function openUserEditor(u) {
  const isNew = !u;
  const isBuiltin = !!(u && u.is_builtin);
  modal(isNew ? '新增账号' : '编辑账号 · ' + u.username, `
    ${isBuiltin ? '<div class="statusline" style="margin-bottom:13px;border-color:#f0dcb4;background:#fdf7e8;color:#8a6410">这是<b>系统内置超级管理员</b>，角色与启用状态受保护不可修改；可修改姓名、备注与密码。</div>' : ''}
    <div class="form-grid">
      <div class="fld"><span>账号 <b style="color:#c0392b">*</b></span>
        <input type="text" id="uName" value="${esc(isNew ? '' : u.username)}" ${isNew ? '' : 'disabled'} placeholder="3-32 位字母数字"></div>
      <div class="fld"><span>姓名 / 显示名</span>
        <input type="text" id="uDisp" value="${esc(isNew ? '' : u.display_name || '')}"></div>
      <div class="fld${isNew ? '' : ' full'}"><span>${isNew ? '初始密码 <b style="color:#c0392b">*</b>' : '新密码（留空则不修改）'}</span>
        <input type="text" id="uPwd" placeholder="${isNew ? '至少 8 位' : '留空表示不改密码'}"></div>
      <div class="fld full"><span>角色${isBuiltin ? ' <small style="color:#8a95a5">（内置账号已锁定）</small>' : ''}</span>
        <select id="uRole" ${isBuiltin ? 'disabled' : ''}>
          <option value="viewer" ${u && u.role === 'viewer' ? 'selected' : ''}>浏览人员（仅查看）</option>
          <option value="editor" ${u && u.role === 'editor' ? 'selected' : ''}>编辑人员（查看 + 编辑内容）</option>
          <option value="super_admin" ${u && u.role === 'super_admin' ? 'selected' : ''}>超级管理员（全部权限，含账号管理）</option>
        </select></div>
      <div class="fld full"><span>细粒度权限</span>
        <div class="chk-row">
          <label class="chk"><input type="checkbox" id="pView" ${!u || u.can_view ? 'checked' : ''} ${isBuiltin ? 'disabled' : ''}>浏览查看权限</label>
          <label class="chk"><input type="checkbox" id="pEdit" ${u && u.can_edit ? 'checked' : ''} ${isBuiltin ? 'disabled' : ''}>页面编辑权限（改行业/职业/城市数据）</label>
          <label class="chk"><input type="checkbox" id="pMng" ${u && u.can_manage ? 'checked' : ''} disabled>账号管理权限（仅超级管理员）</label>
        </div></div>
      <div class="fld"><span>账号状态</span>
        <div class="chk-row" style="padding-top:7px">
          <label class="chk"><input type="checkbox" id="uEn" ${!u || u.enabled ? 'checked' : ''} ${isBuiltin ? 'disabled' : ''}>启用</label>
          <label class="chk"><input type="checkbox" id="uMc" ${isNew || (u && u.must_change) ? 'checked' : ''}>首次登录须改密</label>
        </div></div>
      <div class="fld full"><span>备注</span>
        <input type="text" id="uRemark" value="${esc(u ? u.remark || '' : '')}" placeholder="如：授信审批部 · 张主任"></div>
    </div>
    <p class="hint">选择「超级管理员」会自动开启全部权限；系统会保留至少一个启用的超级管理员，无法把最后一个降级或停用。</p>
  `, `<button class="btn" id="uCancel">取消</button><button class="btn green" id="uSave">保存</button>`, { wide: true });

  const syncRole = () => {
    const r = $('#uRole').value;
    if (r === 'super_admin') { $('#pView').checked = $('#pEdit').checked = $('#pMng').checked = true; }
    else { $('#pMng').checked = false; if (r === 'viewer') $('#pEdit').checked = false; }
  };
  $('#uRole').onchange = syncRole;
  $('#uCancel').onclick = closeModal;
  $('#uSave').onclick = async () => {
    const body = {
      display_name: $('#uDisp').value.trim(),
      role: $('#uRole').value,
      can_view: $('#pView').checked,
      can_edit: $('#pEdit').checked,
      enabled: $('#uEn').checked,
      must_change: $('#uMc').checked,
      remark: $('#uRemark').value.trim(),
    };
    const pwd = $('#uPwd').value;
    if (pwd) body.password = pwd;
    try {
      if (isNew) {
        body.username = $('#uName').value.trim();
        if (!body.username) { toast('请填写账号', '', 'warn'); return; }
        if (!pwd) { toast('请设置初始密码', '', 'warn'); return; }
        await api('/api/admin/users', { method: 'POST', body });
        toast('账号已创建', body.username);
      } else {
        await api('/api/admin/users/' + u.id, { method: 'PUT', body });
        toast('已保存', u.username);
      }
      closeModal(); go('admin_users');
    } catch (e) { toast('保存失败', e.message, 'err'); }
  };
}

function resetPwd(id, username) {
  modal('重置密码 · ' + username, `
    <div class="fld"><span>新密码</span><input type="text" id="rpV" placeholder="至少 8 位"></div>
    <p class="hint">重置后该账号的现有登录会话不会立即失效；如需强制下线，请到「登录与操作日志」页的在线会话中处理。默认会要求该账号下次登录时修改密码。</p>
  `, `<button class="btn" id="rpC">取消</button><button class="btn green" id="rpS">确认重置</button>`);
  $('#rpC').onclick = closeModal;
  $('#rpS').onclick = async () => {
    const pw = $('#rpV').value;
    if (pw.length < 8) { toast('密码至少 8 位', '', 'warn'); return; }
    try {
      await api('/api/admin/users/' + id, { method: 'PUT', body: { password: pw, must_change: true } });
      toast('密码已重置', username); closeModal(); go('admin_users');
    } catch (e) { toast('重置失败', e.message, 'err'); }
  };
}

// ================================================================== 系统管理：日志
async function pageAdminLogs(c) {
  c.innerHTML = '<div class="loading"><span class="spin"></span>加载中…</div>';
  let lg, au, ss;
  try {
    lg = await api('/api/admin/login-log?limit=200');
    au = await api('/api/admin/audit-log?limit=200');
    ss = await api('/api/admin/sessions');
  } catch (e) { c.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }

  const okN = lg.rows.filter((r) => r.ok).length;
  const failN = lg.rows.length - okN;
  const activeN = ss.sessions.filter((s) => s.active).length;

  c.innerHTML = `
  <div class="stat-grid">
    <div class="stat"><div class="n">${lg.total}</div><div class="l">登录记录总数</div></div>
    <div class="stat g"><div class="n">${okN}</div><div class="l">成功（最近200条内）</div></div>
    <div class="stat r"><div class="n">${failN}</div><div class="l">失败（最近200条内）</div></div>
    <div class="stat o"><div class="n">${activeN}</div><div class="l">当前在线会话</div></div>
    <div class="stat"><div class="n">${au.total}</div><div class="l">内容/账号操作记录</div></div>
  </div>

  <div class="card">${cardHead('🛰', '登录日志', '记录账号、结果、IP、设备、浏览器、操作系统与完整 UA')}
    <div class="card-bd">
      <div class="toolbar">
        <input type="text" id="lgU" placeholder="按账号筛选…">
        <label class="chk"><input type="checkbox" id="lgOk">只看成功</label>
        <button class="btn" id="lgBtn">查询</button>
        <span class="sp"></span>
        <span class="hint" id="lgCnt">共 ${lg.total} 条</span>
      </div>
      <div class="tbl-wrap" style="max-height:420px"><table class="tbl" id="lgTbl"></table></div>
    </div></div>

  <div class="card">${cardHead('💻', '在线与历史会话', '可强制下线任意会话')}
    <div class="card-bd"><div class="tbl-wrap" style="max-height:330px"><table class="tbl">
      <thead><tr><th>账号</th><th>姓名</th><th>登录时间</th><th>过期时间</th><th>IP</th><th>设备</th><th>浏览器</th><th>系统</th><th>状态</th><th>操作</th></tr></thead>
      <tbody>${ss.sessions.map((s) => `<tr>
        <td class="code">${esc(s.username)}</td><td>${esc(s.display_name || '')}</td>
        <td class="nowrap">${esc(fmt(s.created_at))}</td><td class="nowrap">${esc(fmt(s.expires_at))}</td>
        <td class="mono nowrap">${esc(s.ip || '—')}</td>
        <td class="nowrap">${esc(s.device)}</td><td class="nowrap">${esc(s.browser)}</td><td class="nowrap">${esc(s.os_name)}</td>
        <td>${s.active ? '<span class="tag green">在线</span>' : '<span class="tag gray">已下线</span>'}</td>
        <td>${s.active ? `<button class="btn sm danger rv" data-t="${esc(s.token)}">强制下线</button>` : '<span style="color:#a9b3c2">—</span>'}</td>
      </tr>`).join('') || '<tr><td colspan="10" class="empty">暂无会话</td></tr>'}</tbody></table></div>
    </div></div>

  <div class="card">${cardHead('📝', '内容与账号操作日志', '记录谁在何时从哪个 IP 改了什么（含改动前后值）')}
    <div class="card-bd"><div class="tbl-wrap" style="max-height:420px"><table class="tbl">
      <thead><tr><th>时间</th><th>操作人</th><th>动作</th><th>数据集</th><th>记录</th><th>字段</th><th>原值</th><th>新值</th><th>IP</th></tr></thead>
      <tbody>${au.rows.map((r) => `<tr>
        <td class="nowrap">${esc(fmt(r.at))}</td><td class="code">${esc(r.username)}</td>
        <td><span class="tag ${/删除/.test(r.action) ? 'red' : /新增|创建/.test(r.action) ? 'green' : 'blue'}">${esc(r.action)}</span></td>
        <td class="nowrap">${esc(r.collection || '—')}</td><td class="wrap" style="max-width:180px">${esc(r.target || '—')}</td>
        <td class="nowrap">${esc(r.field || '—')}</td>
        <td class="wrap" style="max-width:200px;color:#8a95a5">${esc(trunc(r.old_value, 90))}</td>
        <td class="wrap" style="max-width:200px">${esc(trunc(r.new_value, 90))}</td>
        <td class="mono nowrap">${esc(r.ip || '—')}</td></tr>`).join('') || '<tr><td colspan="9" class="empty">暂无操作记录</td></tr>'}</tbody></table></div>
      <p class="hint" style="margin-top:9px">共 ${au.total} 条，此处显示最近 200 条。</p>
    </div></div>`;

  const renderLg = (rows) => {
    $('#lgTbl').innerHTML = `<thead><tr><th>时间</th><th>账号</th><th>结果</th><th>失败原因</th><th>IP</th><th>公网 IP</th><th>设备</th><th>浏览器</th><th>系统</th><th>User-Agent</th></tr></thead>
      <tbody>${rows.map((r) => `<tr>
        <td class="nowrap">${esc(fmt(r.at))}</td>
        <td class="code">${esc(r.username)}</td>
        <td>${r.ok ? '<span class="tag green">成功</span>' : '<span class="tag red">失败</span>'}</td>
        <td>${esc(r.reason || '—')}</td>
        <td class="mono nowrap">${esc(r.ip || '—')}</td>
        <td class="mono nowrap">${esc(r.ip_public || '—')}</td>
        <td class="nowrap">${esc(r.device)}</td><td class="nowrap">${esc(r.browser)}</td><td class="nowrap">${esc(r.os_name)}</td>
        <td class="wrap mono" style="max-width:280px;font-size:11px;color:#8a95a5">${esc(trunc(r.user_agent, 120))}</td>
      </tr>`).join('') || '<tr><td colspan="10" class="empty">暂无登录记录</td></tr>'}</tbody>`;
  };
  renderLg(lg.rows);
  const doLg = async () => {
    const p = new URLSearchParams({ limit: 200 });
    if ($('#lgU').value.trim()) p.set('username', $('#lgU').value.trim());
    if ($('#lgOk').checked) p.set('only_ok', '1');
    try {
      const r = await api('/api/admin/login-log?' + p.toString());
      renderLg(r.rows); $('#lgCnt').textContent = `共 ${r.total} 条`;
    } catch (e) { toast('查询失败', e.message, 'err'); }
  };
  $('#lgBtn').onclick = doLg;
  $('#lgU').onkeydown = (e) => { if (e.key === 'Enter') doLg(); };
  $$('.rv').forEach((b) => { b.onclick = async () => {
    if (!confirm('确定强制下线该会话？')) return;
    try { await api('/api/admin/sessions/revoke', { method: 'POST', body: { token: b.dataset.t } }); toast('已下线'); go('admin_logs'); }
    catch (e) { toast('操作失败', e.message, 'err'); }
  }; });
}

// ================================================================== 系统自检与设置
async function pageAdminSys(c) {
  c.innerHTML = '<div class="loading"><span class="spin"></span>正在自检…</div>';
  let sc, st, ps;
  try {
    sc = (await api('/api/admin/selfcheck')).selfcheck;
    st = (await api('/api/admin/settings')).settings;
    ps = (await api('/api/admin/persist')).persist;
  }
  catch (e) { c.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }

  const item = (label, ok, detail) => `<tr><th>${esc(label)}</th>
    <td>${ok ? '<span class="tag green">✓ 通过</span>' : '<span class="tag red">✗ 异常</span>'}</td>
    <td class="wrap">${detail}</td></tr>`;

  c.innerHTML = `
  <div class="card">${cardHead('🩺', '数据自检（与 Excel 看板对账）', sc.通过 ? '<span class="tag green">全部通过</span>' : '<span class="tag red">存在异常</span>')}
    <div class="card-bd tight"><table class="kv">
      ${item('行业总数', sc.行业总数 === 99, `${sc.行业总数} 个（Excel <code>_idx</code> 为 99 个）`)}
      ${item('职业覆盖行业', sc.缺职业的行业.length === 0, sc.缺职业的行业.length
        ? `缺 ${sc.缺职业的行业.length} 个：${esc(sc.缺职业的行业.join('、'))}`
        : `${sc.职业覆盖行业数}/${sc.行业总数} 个行业全部有职业明细（共 ${sc.职业总条数} 条）`)}
      ${item('经营模式覆盖', sc.缺经营模式的行业.length === 0, sc.缺经营模式的行业.length
        ? `缺 ${sc.缺经营模式的行业.length} 个：${esc(sc.缺经营模式的行业.join('、'))}`
        : `${sc.模式覆盖行业数}/${sc.行业总数} 个行业全部有经营模式`)}
      ${item('城市风险完整性', sc.缺失城市风险.length === 0,
        `${sc.城市风险记录数} 条 / 应为 ${sc.应有城市风险记录数} 条（${sc.行业总数} 行业 × ${sc.城市数} 城市）`
        + (sc.缺失城市风险.length ? `<br>缺失样例：${esc(sc.缺失城市风险.slice(0, 10).join('、'))}` : ''))}
      ${item('字段无空值', sc.空字段总数 === 0, sc.空字段总数
        ? `${sc.空字段总数} 处空字段：${esc(sc.空字段.slice(0, 6).join('；'))}` : '所有记录字段均已填充')}
      ${item('「面签」已全部改为「审核」', !sc.存在面签字样, sc.存在面签字样
        ? '仍存在「面签」字样，请检查' : '全库检索无「面签」字样，字段名与内容均已统一为「审核」')}
      <tr><th>人工编辑覆盖</th><td><span class="tag blue">${sc.人工编辑覆盖字段数} 处</span></td>
        <td class="wrap">已修改的字段数（原始 Excel 数据始终保留，可在编辑弹窗中「还原为原始值」）</td></tr>
    </table></div></div>

  <div class="card">${cardHead('⚙️', '站点设置', '')}
    <div class="card-bd">
      <div class="form-grid">
        <div class="fld full"><span>站点标题</span><input type="text" id="stTitle" value="${esc(st.site_title || '小微行业知识库')}"></div>
        <div class="fld full"><span>首页公告（留空则不显示）</span><textarea id="stNotice" rows="3" style="width:100%;padding:9px 12px;border:1px solid var(--c-line);border-radius:6px">${esc(st.notice || '')}</textarea></div>
        <div class="fld"><span>数据版本标识</span><input type="text" id="stVer" value="${esc(st.data_version || 'V3')}"></div>
        <div class="fld"><span>会话有效期（小时）</span><input type="text" id="stSess" value="${esc(st.session_hours || '12')}"></div>
      </div>
      <div class="btn-row"><button class="btn green" id="stSave">保存设置</button></div>
    </div></div>

  <div class="card">${cardHead('💾', '数据持久化（云端部署必读）',
      ps.mode.includes('GitHub') ? '<span class="tag green">已接入 GitHub</span>' : '<span class="tag gold">仅本地</span>')}
    <div class="card-bd">
      <div class="statusline" style="margin-bottom:12px">
        免费云平台（Render / Railway / Fly 等）的文件系统是<b>临时的</b>，重启就会清空。
        本系统会把账号、权限、人工编辑内容、日志打包成快照，推送到 GitHub 仓库的独立分支
        <b>${esc(ps.branch || 'xwk-persist')}</b>；重启时自动拉回，<b>因此你在线修改的内容不会丢</b>。
      </div>
      <table class="kv">
        <tr><th>持久化模式</th><td>${esc(ps.mode)}</td></tr>
        <tr><th>远程仓库</th><td class="mono">${esc(ps.repo)}</td></tr>
        <tr><th>快照分支</th><td class="mono">${esc(ps.branch || '—')}（独立分支，不会触发重新部署）</td></tr>
        <tr><th>自动保存间隔</th><td>${ps.interval_sec} 秒（有改动才写，无改动跳过）</td></tr>
        <tr><th>日志保留条数</th><td>登录日志与操作日志各保留最近 ${ps.log_cap} 条</td></tr>
        <tr><th>账号数据是否随快照保存</th><td>${ps.account_data_persisted
            ? '<span class="tag green">是</span>（仓库为私有，或已确认安全）'
            : '<span class="tag red">否</span> —— 仓库为公开时会自动跳过账号与日志，防止密码哈希外泄。改为私有仓库即可开启。'}</td></tr>
        <tr><th>已成功推送次数</th><td>${ps.push_count} 次</td></tr>
        <tr><th>最近一次保存</th><td>${ps.last_push_at ? esc(fmt(ps.last_push_at)) : '<span style="color:#a9b3c2">尚未保存</span>'}
          ${ps.last_push_at ? (ps.last_push_ok ? '<span class="tag green">成功</span>' : '<span class="tag red">失败</span>') : ''}</td></tr>
        <tr><th>最近保存说明</th><td class="wrap">${esc(ps.last_push_msg || '—')}</td></tr>
      </table>
      <div class="btn-row" style="margin-top:12px">
        <button class="btn green" id="psSave">立即保存快照</button>
        <button class="btn" id="psReload">刷新状态</button>
      </div>
      <p class="hint" style="margin-top:9px">建议在<b>关机前</b>或<b>云平台重新部署前</b>点一次「立即保存快照」。</p>
    </div></div>

  <div class="card">${cardHead('🚀', '运行与外网访问', '')}
    <div class="card-bd">
      <table class="kv">
        <tr><th>本机访问</th><td class="mono">${esc(location.origin)}</td></tr>
        <tr><th>外网访问</th><td>在项目目录另开一个终端运行 <code>npm run tunnel</code>，
          会显示一个 <code>https://xxx.loca.lt</code> 公网地址（每次重启地址会变）</td></tr>
        <tr><th>后端服务</th><td><code>npm start</code>（默认端口 3210，可用 <code>PORT=xxxx npm start</code> 修改）</td></tr>
        <tr><th>数据存储</th><td><code>data/xwk.db</code>（SQLite，账号/权限/日志/编辑覆盖）＋ <code>data/seed.json</code>（Excel 提取的原始数据）</td></tr>
        <tr><th>安全提示</th><td style="color:#c0392b">公网暴露前请务必：① 修改超级管理员默认密码；② 只给需要的人开账号；
          ③ localtunnel 首次访问会出现一个确认页，点击「Click to Continue」即可进入本站登录页</td></tr>
      </table>
    </div></div>`;

  $('#stSave').onclick = async () => {
    try {
      await api('/api/admin/settings', { method: 'POST', body: {
        site_title: $('#stTitle').value.trim(), notice: $('#stNotice').value,
        data_version: $('#stVer').value.trim(), session_hours: $('#stSess').value.trim(),
      }});
      toast('设置已保存');
    } catch (e) { toast('保存失败', e.message, 'err'); }
  };
  $('#psSave').onclick = async (e) => {
    const b = e.currentTarget;
    b.disabled = true; b.textContent = '保存中…';
    try {
      const r = await api('/api/admin/persist/save', { method: 'POST' });
      if (r.result && r.result.error) toast('推送失败', r.result.error, 'err');
      else if (r.result && r.result.skipped) toast('无变化', '数据与上次快照一致，未重复推送');
      else toast('快照已保存', r.persist ? r.persist.last_push_msg : '');
      go('admin_sys');
    } catch (err) { toast('保存失败', err.message, 'err'); b.disabled = false; b.textContent = '立即保存快照'; }
  };
  $('#psReload').onclick = () => go('admin_sys');
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
  admin_users: pageAdminUsers, admin_logs: pageAdminLogs, admin_sys: pageAdminSys,
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
  $('#userRole').textContent = (ROLE_NAME[S.user.role] || S.user.role)
    + (S.user.can_edit ? ' · 可编辑' : ' · 只读');
  $('#userAvatar').textContent = dn.slice(0, 1).toUpperCase();
  $('#editFlag').style.display = S.user.can_edit ? '' : 'none';
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
    if (r.user.must_change) {
      toast('请修改初始密码', '为保证账号安全，建议立即修改', 'warn');
      setTimeout(() => openPwdModal(true), 400);
    } else {
      toast('登录成功', `${r.user.display_name || r.user.username} · ${ROLE_NAME[r.user.role] || r.user.role}`);
    }
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
    await refreshMeta();
    showApp();
    if (S.user.must_change) setTimeout(() => openPwdModal(true), 500);
  } catch (e) {
    S.token = ''; localStorage.removeItem('xwk_token');
  }
})();
