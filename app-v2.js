/* ============================================================
   小微行业知识库 V3 · 纯静态版
   全部数据前端加载，无后端依赖
   ============================================================ */
'use strict';

// ------------------------------------------------------------------ 预定义账号
const USERS = [
  { id: 1, username: 'admin', password: 'wt1201263', display_name: '管理员', role: 'super_admin', can_edit: true, can_view: true, can_manage: true, remark: '系统管理员' },
];

const ROLE_NAME = { super_admin: '超级管理员', editor: '编辑人员', viewer: '浏览人员' };

// ------------------------------------------------------------------ 状态
const S = {
  user: null,
  page: 'dashboard',
  meta: null,
  dash: { industry: '', job: '', city: '', ci: new Set(), cj: new Set(), cc: new Set() },
  dashData: null,
  edits: JSON.parse(localStorage.getItem('xwk_edits') || '{}'),
};

const D = window.XWK_DATA || {};
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const nl2br = (v) => esc(v).replace(/\n/g, '<br>');

// ------------------------------------------------------------------ 数据初始化
function initData() {
  S.meta = D.meta || {};
  S.meta.cities = D.cities || [];
  const cats = {};
  (D.industries || []).forEach((i) => {
    const cat = i['行业门类'];
    if (!cats[cat]) cats[cat] = [];
    cats[cat].push(i['行业编号']);
  });
  S.meta.categories = cats;
}

// ------------------------------------------------------------------ 编辑覆盖层
function getRecord(collection, rec) {
  const key = keyOf(collection, rec);
  const ov = S.edits[collection] && S.edits[collection][key];
  if (!ov) return rec;
  return { ...rec, ...ov };
}
function saveEdit(collection, recKey, field, value) {
  if (!S.edits[collection]) S.edits[collection] = {};
  if (!S.edits[collection][recKey]) S.edits[collection][recKey] = {};
  S.edits[collection][recKey][field] = value;
  localStorage.setItem('xwk_edits', JSON.stringify(S.edits));
}
function revertRecord(collection, recKey) {
  if (S.edits[collection]) delete S.edits[collection][recKey];
  localStorage.setItem('xwk_edits', JSON.stringify(S.edits));
}
function getCollection(collection) {
  const raw = D[collection] || [];
  return raw.map((r) => getRecord(collection, r));
}

function keyOf(collection, r) {
  if (collection === 'industries') return r['行业编号'];
  if (collection === 'modes') return r['行业编号'] + '|' + r['细分模式'];
  if (collection === 'jobs') return r['行业编号'] + '|' + r['常见职位'];
  if (collection === 'city_risks') return r['行业编号'] + '|' + r['城市'];
  if (collection === 'cities') return r['城市名称'];
  return '';
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

// ------------------------------------------------------------------ 页面路由（提前定义，供 go() 引用）
var PAGES = {};

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
    { id: 'transfer', ico: '🔄', t: '数据导出' },
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
        ${b ? `<span class="badge">${b}</span>` : ''}</div>`;
    }
    h += '</div>';
  }
  nav.innerHTML = h;
  $$('.nav-item', nav).forEach((el) => { el.onclick = () => go(el.dataset.page); });
}

const PAGE_TITLE = {
  dashboard: '数据看板', analytics: '统计分析', industries: '行业管理', jobs: '职业管理',
  cityrisks: '城市风控', modes: '经营模式', search: '全局搜索', transfer: '数据导出',
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
function pageDashboard(c) {
  const q = S.dash;
  c.innerHTML = `
    <div class="qbar">
      <div class="qbox">
        <div class="qt"><span class="n">1</span>行业查询</div>
        <input type="text" id="qInd" placeholder="输入行业编号（如 JZ08）、行业名或关键词（如 劳务、火锅、软件、钢材、宠物、光伏）" value="${esc(q.industry)}">
        <div class="qmeta" id="mInd">—</div>
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

    <div class="statusline" id="statusLine">—</div>
    <div class="idbox" id="idBox"></div>
    <div id="dashBody"></div>
  `;

  const deb = debounce(() => loadDash(), 260);
  $('#qInd').oninput = (e) => { S.dash.industry = e.target.value; deb(); };
  $('#qJob').oninput = (e) => { S.dash.job = e.target.value; deb(); };
  $('#qCity').oninput = (e) => { S.dash.city = e.target.value; deb(); };
  loadDash();
}

function buildDashData(q) {
  const industries = getCollection('industries');
  const allJobs = getCollection('jobs');
  const allModes = getCollection('modes');
  const allCities = D.cities || [];
  const allRisks = getCollection('city_risks');

  const indQ = (q.industry || '').trim();
  let candidates = [];
  let resolvedCode = null;
  let industry = null;

  // Chip selection takes priority
  if (q.ci.size > 0) {
    const code = [...q.ci][0].split('-')[0];
    const found = industries.find((i) => i['行业编号'] === code);
    if (found) { resolvedCode = code; industry = found; }
  }

  // If no chip selected, try to resolve from query
  if (!resolvedCode && indQ) {
    const kw = indQ.toLowerCase();
    // Direct code match
    const codeMatch = industries.find((i) => i['行业编号'].toLowerCase() === kw);
    if (codeMatch) {
      resolvedCode = codeMatch['行业编号'];
      industry = codeMatch;
    } else {
      // Keyword search across multiple fields
      candidates = industries.filter((i) => {
        return i['行业编号'].toLowerCase().includes(kw) ||
               (i['细分行业'] || '').toLowerCase().includes(kw) ||
               (i['行业门类'] || '').toLowerCase().includes(kw) ||
               (i['职业标签串'] || '').toLowerCase().includes(kw) ||
               (i['典型经营主体形态'] || '').toLowerCase().includes(kw) ||
               (i['典型融资用途'] || '').toLowerCase().includes(kw) ||
               (i['必备证照资质'] || '').toLowerCase().includes(kw);
      }).slice(0, 6);
      candidates = candidates.map((i) => `${i['行业编号']}-${i['细分行业']}`);

      // Auto-resolve if only one candidate
      if (candidates.length === 1) {
        const code = candidates[0].split('-')[0];
        industry = industries.find((i) => i['行业编号'] === code);
        resolvedCode = industry ? industry['行业编号'] : null;
        candidates = [];
      }
    }
  }

  const industryLabel = industry ? `${industry['行业编号']}-${industry['细分行业']}` : '';

  // Jobs
  let jobsAll = [];
  let jobsHit = 0;
  let jobsShown = [];

  if (resolvedCode) {
    jobsAll = allJobs.filter((j) => j['行业编号'] === resolvedCode);
    const jobQ = (q.job || '').trim().toLowerCase();
    if (jobQ) {
      jobsAll = jobsAll.map((j) => {
        const hit = (j['常见职位'] || '').toLowerCase().includes(jobQ) ||
                     (j['这个岗位每天干什么'] || '').toLowerCase().includes(jobQ) ||
                     (j['审核时怎么问'] || '').toLowerCase().includes(jobQ);
        return { ...j, '命中': hit, '三段式标签': j['常见职位'] };
      });
      jobsHit = jobsAll.filter((j) => j['命中']).length;
    } else {
      jobsAll = jobsAll.map((j) => ({ ...j, '命中': true, '三段式标签': j['常见职位'] }));
      jobsHit = jobsAll.length;
    }
    jobsShown = jobsAll.filter((j) => j['命中']).slice(0, 10);
  }

  // Cities
  const cityQ = (q.city || '').trim().toLowerCase();
  let matchedCities = allCities;
  if (cityQ) {
    matchedCities = allCities.filter((c) =>
      (c['城市名称'] || '').toLowerCase().includes(cityQ) ||
      (c['定位标签'] || '').toLowerCase().includes(cityQ)
    );
  }
  if (q.cc.size > 0) {
    matchedCities = allCities.filter((c) => q.cc.has(c['城市名称']));
  }
  const cityHit = matchedCities.length;
  const cityShown = matchedCities.slice(0, 8);

  // City risks
  const cityRisks = cityShown.map((c) => {
    if (resolvedCode) {
      const risk = allRisks.find((r) => r['行业编号'] === resolvedCode && r['城市'] === c['城市名称']);
      return {
        '城市': c['城市名称'],
        '定位标签': c['定位标签'] || '',
        '风险层级': risk ? risk['风险层级'] : '',
        '依据与尽调要点': risk ? risk['依据与尽调要点'] : ''
      };
    }
    return {
      '城市': c['城市名称'],
      '定位标签': c['定位标签'] || '',
      '风险层级': '',
      '依据与尽调要点': ''
    };
  });

  // Modes
  const modes = resolvedCode ? allModes.filter((m) => m['行业编号'] === resolvedCode) : [];

  // Selected jobs (for chips)
  const jobsForChips = resolvedCode ? allJobs : [];

  return {
    status: {
      industry: resolvedCode ? industry['细分行业'] : (indQ ? `未找到匹配「${indQ}」的行业` : '请输入行业编号或关键词'),
      job: (q.job || '').trim() || '全部职位',
      city: (q.city || '').trim() || '全部城市',
    },
    resolvedCode,
    industryLabel,
    candidateTotal: candidates.length,
    candidates,
    industry,
    jobs: {
      total: resolvedCode ? allJobs.filter((j) => j['行业编号'] === resolvedCode).length : 0,
      hit: jobsHit,
      shownCount: jobsShown.length,
      shown: jobsShown,
      all: jobsForChips,
    },
    cities: {
      hit: cityHit,
      shownCount: cityShown.length,
      shown: cityRisks,
    },
    modes,
  };
}

function loadDash() {
  const d = buildDashData(S.dash);
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
  ` : `<div><div class="k">识别编号</div><div class="v" style="color:#94a3b8">未定位</div></div>
      <div><div class="k">提示</div><div class="v" style="font-size:13px;font-weight:400;color:#475569">
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
      [...q.ci].forEach((x) => { if (x !== code) q.ci.delete(x); });
      q.industry = el.dataset.label;
      $('#qInd').value = q.industry;
      loadDash();
    };
  });

  // ② 职业 chips
  const jq = $('#qJob');
  jq.disabled = !d.resolvedCode;
  const allJobsForChips = d.jobs.all || [];
  $('#mJob').innerHTML = d.resolvedCode
    ? `本行业 <b>${d.jobs.total}</b> 个职位｜命中 <b>${d.jobs.hit}</b>｜显示 <b>${d.jobs.shownCount}</b>${d.jobs.shownCount > 10 ? '（看板最多 10）' : ''}`
    : '请先选定行业';
  $('#chJob').innerHTML = d.resolvedCode
    ? allJobsForChips.map((r) => {
        const on = q.cj.has(r['常见职位']);
        const dim = !r['命中'];
        return `<span class="chip${on ? ' on' : ''}${dim ? ' dim' : ''}" data-j="${esc(r['常见职位'])}">${esc(r['常见职位'])}</span>`;
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
  const cityNames = (D.cities || []).map((c) => c['城市名称']);
  const cityQ = (q.city || '').trim().toLowerCase();
  const cityMatched = cityQ
    ? (D.cities || []).filter((c) => (c['城市名称'] || '').toLowerCase().includes(cityQ) || (c['定位标签'] || '').toLowerCase().includes(cityQ))
    : (D.cities || []);
  $('#mCity').innerHTML = `命中 <b>${cityMatched.length}</b> 个城市｜显示 <b>${d.cities.shownCount}</b>${d.cities.shownCount > 8 ? '（看板最多 8）' : ''}`;
  $('#chCity').innerHTML = cityMatched.map((c) => {
    const on = q.cc.has(c['城市名称']);
    return `<span class="chip${on ? ' on' : ''}" data-c="${esc(c['城市名称'])}" title="${esc(c['定位标签'] || '')}">${esc(c['城市名称'])}</span>`;
  }).join('');
  $$('#chCity .chip').forEach((el) => {
    el.onclick = () => {
      const cn = el.dataset.c;
      if (q.cc.has(cn)) q.cc.delete(cn); else q.cc.add(cn);
      loadDash();
    };
  });

  // 主体区块
  $('#dashBody').innerHTML = sec01(d) + sec02(d) + sec03(d) + sec04(d) + sec05(d);
  bindEdits($('#dashBody'));
  bindModeToggles($('#dashBody'));
}

function cardHead(no, title, sub) {
  return `<div class="card-hd"><h3>${no ? `<span class="no">${no}</span>` : ''}${esc(title)}</h3>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;
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
  const txt = empty ? '<span style="color:#94a3b8">—</span>' : nl2br(value);
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
          : '<span style="color:#94a3b8">—</span>'}</td>
        <td class="basis">${d.resolvedCode ? nl2br(r['依据与尽调要点']) : '<span style="color:#94a3b8">请先选定行业</span>'}</td>
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
        <span style="margin-left:auto">数据口径：各市统计局 2026 年上半年发布数据</span>
      </div>
    </div></div>`;
}

// ------------------------------------------------------------------ 内联编辑
function bindEdits(root) {
  $$('.ed-btn', root).forEach((b) => {
    b.onclick = () => openEditor(b.dataset.c, b.dataset.k, b.dataset.f);
  });
}

function openEditor(collection, recKey, field) {
  const pool = getCollection(collection);
  const cur = pool.find((r) => keyOf(collection, r) === recKey) || null;
  const val = cur ? (cur[field] == null ? '' : cur[field]) : '';
  modal(`编辑 · ${lb(field)}`, `
    <div class="fld"><span>记录</span><input type="text" value="${esc(recKey)}" disabled></div>
    <div class="fld"><span>${esc(lb(field))}</span>
      <textarea id="edVal" rows="10" style="width:100%;padding:10px 13px;border:1px solid var(--c-line);border-radius:6px;line-height:1.75">${esc(val)}</textarea>
    </div>
    <p class="hint">修改保存在浏览器本地，原始数据不受影响，可随时还原。</p>
  `, `<button class="btn" id="edRevert">还原</button>
      <button class="btn" id="edCancel">取消</button>
      <button class="btn green" id="edSave">保存</button>`);
  $('#edCancel').onclick = closeModal;
  $('#edSave').onclick = () => {
    const nv = $('#edVal').value;
    saveEdit(collection, recKey, field, nv);
    toast('已保存', `字段已更新（保存在浏览器本地）`);
    closeModal();
    if (S.page === 'dashboard') loadDash(); else go(S.page);
  };
  $('#edRevert').onclick = () => {
    if (!confirm('确定还原这条记录的全部字段为原始值？')) return;
    revertRecord(collection, recKey);
    toast('已还原', '该记录已恢复为原始数据');
    closeModal();
    if (S.page === 'dashboard') loadDash(); else go(S.page);
  };
  setTimeout(() => $('#edVal').focus(), 40);
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
function dataTablePage(c, cfg) {
  c.innerHTML = `
    <div class="card">
      ${cardHead(cfg.no || '', cfg.title, cfg.sub || '')}
      <div class="card-bd">
        <div class="toolbar" id="tb"></div>
        <div class="tbl-wrap" id="tw"></div>
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

  const allData = getCollection(cfg.name);

  const reload = () => {
    const kw = st.q.trim().toLowerCase();
    let filtered = allData;
    if (kw) {
      filtered = allData.filter((r) => {
        return Object.values(r).some((v) => String(v || '').toLowerCase().includes(kw));
      });
    }
    st.total = filtered.length;
    $('#cnt').textContent = `共 ${st.total} 条`;
    const start = (st.page - 1) * st.size;
    const rows = filtered.slice(start, start + st.size);
    renderRows(rows);
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
        </td>` : ''}</tr>`;
      }).join('')}</tbody></table>`;
    $$('.act-ed', $('#tw')).forEach((b) => {
      b.onclick = () => openRecordEditor(cfg, b.dataset.k, allData.find((r) => keyOf(cfg.name, r) === b.dataset.k));
    });
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
  reload();
}

function openRecordEditor(cfg, recKey, rec) {
  const isNew = !rec;
  const fields = cfg.editFields || cfg.columns.filter((x) => !x.noEdit).map((x) => x.k);
  const tpl = rec || {};
  const body = `<div class="form-grid">${fields.map((f) => {
    const v = tpl[f] == null ? '' : tpl[f];
    const long = String(v).length > 40 || ['依据与尽调要点', '这个岗位每天干什么', '审核时怎么问', '能查到哪些证据',
      '真干过的人怎么答', '没干过的破绽', '主要经营风险', '政策与外部驱动', '前景趋势判断', '季节性资金缺口高峰',
      '运作方式', '盈利逻辑', '上下游与结算回款方式', '授信关注要点', '典型经营主体形态', '必备证照资质',
      '订单与客户来源', '定位标签', '职业标签串'].includes(f);
    return `<div class="fld${long ? ' full' : ''}">
      <span>${esc(lb(f))}</span>
      ${long
        ? `<textarea rows="4" data-f="${esc(f)}" style="width:100%;padding:9px 12px;border:1px solid var(--c-line);border-radius:6px;line-height:1.7">${esc(v)}</textarea>`
        : `<input type="text" data-f="${esc(f)}" value="${esc(v)}" style="width:100%;padding:8px 11px;border:1px solid var(--c-line);border-radius:6px">`}
    </div>`;
  }).join('')}</div>
  <p class="hint">修改保存在浏览器本地存储中。</p>`;
  modal((isNew ? '新增' : '编辑') + ' · ' + cfg.title, body,
    `<button class="btn" id="rCancel">取消</button><button class="btn green" id="rSave">保存</button>`, { wide: true });
  $('#rCancel').onclick = closeModal;
  $('#rSave').onclick = () => {
    const rec2 = {};
    $$('#modalBody [data-f]').forEach((el) => { rec2[el.dataset.f] = el.value; });
    if (isNew) {
      const k = keyOf(cfg.name, rec2);
      saveEdit(cfg.name, k, '__new__', rec2);
      toast('已新增', k);
    } else {
      const changes = {};
      for (const [f, v] of Object.entries(rec2)) if (String(v) !== String(tpl[f] == null ? '' : tpl[f])) changes[f] = v;
      if (!Object.keys(changes).length) { toast('无变更', '内容没有修改'); closeModal(); return; }
      for (const [f, v] of Object.entries(changes)) saveEdit(cfg.name, recKey, f, v);
      toast('已保存', `更新 ${Object.keys(changes).length} 个字段`);
    }
    closeModal();
    go(S.page);
  };
}

function downloadJson(name) {
  const data = name === 'all' ? D : (getCollection(name) || []);
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
    sub: `共 ${S.meta ? S.meta.industry_count : 0} 个细分行业`,
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
  });
}

function pageJobs(c) {
  return dataTablePage(c, {
    name: 'jobs', no: '04', title: '职业管理（在职客户岗位核实）',
    sub: `共 ${S.meta ? S.meta.job_count : 0} 条岗位明细`,
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
    keyFields: ['行业编号', '常见职位'], editFields: F.jobs_all, size: 50,
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
    keyFields: ['行业编号', '城市'], editFields: F.risks_all, size: 50,
  });
}

function pageModes(c) {
  return dataTablePage(c, {
    name: 'modes', no: '02', title: '经营模式详解',
    sub: `共 ${S.meta ? S.meta.mode_count : 0} 条模式`,
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
  });
}

// ================================================================== 统计分析
function pageAnalytics(c) {
  const industries = getCollection('industries');
  const jobs = getCollection('jobs');
  const modes = getCollection('modes');
  const cities = D.cities || [];
  const risks = getCollection('city_risks');

  const t = {
    行业: industries.length,
    门类: Object.keys(S.meta.categories || {}).length,
    职业: jobs.length,
    经营模式: modes.length,
    城市: cities.length,
    城市风险记录: risks.length,
  };

  // 风险层级分布
  const lv = {};
  risks.forEach((r) => {
    const v = r['风险层级'] || '未定级';
    lv[v] = (lv[v] || 0) + 1;
  });
  const lvTotal = Object.values(lv).reduce((a, b) => a + b, 0) || 1;

  // 门类分布
  const cats = Object.entries(S.meta.categories || {}).map(([n, ids]) => ({ n, v: { 行业数: ids.length, 编号: ids } }))
    .sort((a, b) => b.v.行业数 - a.v.行业数);
  const catMax = cats.length ? cats[0].v.行业数 : 1;

  // 城市风险
  const cityMap = {};
  risks.forEach((r) => {
    const cn = r['城市'];
    if (!cityMap[cn]) cityMap[cn] = {};
    const lv = r['风险层级'] || '未定级';
    cityMap[cn][lv] = (cityMap[cn][lv] || 0) + 1;
  });
  const cityRows = Object.entries(cityMap);
  const citySum = cityRows.map(([cn, m]) => ({
    cn, total: Object.values(m).reduce((a, b) => a + b, 0),
    high: (m['D级·中高风险'] || 0) + (m['E级·高风险'] || 0) + Object.entries(m).filter(([k]) => k.startsWith('C-D')).reduce((a, b) => a + b[1], 0),
    mid: m['C级·中等风险'] || 0,
    low: Object.entries(m).filter(([k]) => k.startsWith('A') || k.startsWith('B')).reduce((a, b) => a + b[1], 0),
    m,
  })).sort((a, b) => b.high - a.high);
  const cMax = Math.max(1, ...citySum.map((x) => x.total));

  // 行业风险指数（按20城层级平均分）
  const lvScore = (s) => {
    if (!s) return null;
    if (s.startsWith('A')) return 1;
    if (s.startsWith('B-C')) return 2.5;
    if (s.startsWith('B')) return 2;
    if (s.startsWith('C-D')) return 4.5;
    if (s.startsWith('C')) return 3;
    if (s.startsWith('D')) return 5;
    if (s.startsWith('E')) return 6;
    return null;
  };
  const indRiskMap = {};
  risks.forEach((r) => {
    const code = r['行业编号'];
    if (!indRiskMap[code]) indRiskMap[code] = { scores: [], city: r['城市'], maxLv: '' };
    const sc = lvScore(r['风险层级']);
    if (sc != null) indRiskMap[code].scores.push(sc);
  });

  const industryRisk = industries.map((ind) => {
    const info = indRiskMap[ind['行业编号']] || { scores: [] };
    const scores = info.scores;
    const avg = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length) : null;
    const maxCity = risks.filter((r) => r['行业编号'] === ind['行业编号'])
      .sort((a, b) => (lvScore(b['风险层级']) || 0) - (lvScore(a['风险层级']) || 0))[0];
    return {
      '行业编号': ind['行业编号'],
      '细分行业': ind['细分行业'],
      '风险指数': avg ? Math.round(avg * 100) / 100 : null,
      '最高风险城市': maxCity ? maxCity['城市'] : '',
    };
  }).filter((x) => x.风险指数 != null);

  const topRisk = industryRisk.slice().sort((a, b) => b.风险指数 - a.风险指数).slice(0, 20);
  const bestRisk = industryRisk.slice().sort((a, b) => a.风险指数 - b.风险指数).slice(-15).reverse();

  // 覆盖完整性
  const cov = industries.map((ind) => {
    const code = ind['行业编号'];
    return {
      '行业编号': code,
      '细分行业': ind['细分行业'],
      职业数: jobs.filter((j) => j['行业编号'] === code).length,
      模式数: modes.filter((m) => m['行业编号'] === code).length,
      城市风险数: risks.filter((r) => r['行业编号'] === code).length,
    };
  });
  const bad = cov.filter((x) => x.职业数 === 0 || x.模式数 === 0 || x.城市风险数 !== t.城市);

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
        <div class="bv">${v} <small style="color:#94a3b8;font-weight:400">${(v / lvTotal * 100).toFixed(1)}%</small></div></div>`).join('')}
    </div></div></div>

  <div class="card">${cardHead('C', '城市风险集中度', '按 D/E 级 + C-D 级记录数排序')}
    <div class="card-bd"><div class="bars">
      ${citySum.map((x) => `<div class="bar-row ${x.high / x.total > .45 ? 'red' : x.high / x.total > .3 ? 'orange' : 'gold'}">
        <div class="bl">${esc(x.cn)}</div>
        <div class="bt"><div class="bf" style="width:${(x.total / cMax * 100).toFixed(1)}%"></div></div>
        <div class="bv" title="高/中高 ${x.high}｜中等 ${x.mid}｜低 ${x.low}">${x.high}<small style="color:#94a3b8;font-weight:400">/${x.total}</small></div></div>`).join('')}
    </div></div></div>

  <div class="card">${cardHead('D', '行业风险热力矩阵', `${t.行业} 行业 × ${t.城市} 城市 · 点击单元格跳转看板`)}
    <div class="card-bd"><div class="heat-wrap" id="heatWrap"></div>
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
    <div class="card-bd" id="covBox"></div></div>
  `;

  // 热力矩阵
  (function () {
    const riskByInd = new Map();
    for (const row of risks) {
      if (!riskByInd.has(row['行业编号'])) riskByInd.set(row['行业编号'], new Map());
      riskByInd.get(row['行业编号']).set(row['城市'], row['风险层级']);
    }
    const cityNames = cities.map((x) => x['城市名称']);
    let h = '<table class="heat"><thead><tr><th style="left:0;z-index:4;background:#f8fafc">行业</th>'
      + cityNames.map((n) => `<th>${esc(n)}</th>`).join('') + '</tr></thead><tbody>';
    for (const a of industryRisk) {
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
      <div class="bv">${x.风险指数} <small style="color:#94a3b8;font-weight:400">${esc(x['最高风险城市'] || '')}</small></div></div>`).join('')}</div>`;
    $$('#rankBox .bar-row .bl').forEach((el, i) => {
      el.style.cursor = 'pointer';
      el.onclick = () => { S.dash = { industry: list[i]['行业编号'], job: '', city: '', ci: new Set(), cj: new Set(), cc: new Set() }; go('dashboard'); };
    });
  };
  renderRank('high');
  $$('[data-rk]').forEach((b) => { b.onclick = () => { $$('[data-rk]').forEach((x) => x.classList.remove('on')); b.classList.add('on'); renderRank(b.dataset.rk); }; });

  // 覆盖完整性
  $('#covBox').innerHTML = `
    <div class="stat-grid" style="margin-bottom:12px">
      <div class="stat g"><div class="n">${cov.filter((x) => x.职业数 > 0).length}/${cov.length}</div><div class="l">有职业数据的行业</div></div>
      <div class="stat g"><div class="n">${cov.filter((x) => x.模式数 > 0).length}/${cov.length}</div><div class="l">有经营模式的行业</div></div>
      <div class="stat ${bad.length ? 'r' : 'g'}"><div class="n">${cov.length - bad.length}/${cov.length}</div><div class="l">三项全齐的行业</div></div>
      <div class="stat"><div class="n">${t.职业}</div><div class="l">职业明细总条数</div></div>
    </div>
    ${bad.length
      ? `<p class="hint" style="margin-bottom:8px;color:#dc2626">以下 ${bad.length} 个行业存在数据缺口：</p>
         <div class="tbl-wrap" style="max-height:260px"><table class="tbl"><thead><tr>
           <th>行业编号</th><th>细分行业</th><th>职业数</th><th>模式数</th><th>城市风险数</th></tr></thead>
           <tbody>${bad.map((x) => `<tr><td class="code">${esc(x['行业编号'])}</td><td>${esc(x['细分行业'])}</td>
             <td>${x.职业数 === 0 ? '<span class="tag red">缺</span>' : x.职业数}</td>
             <td>${x.模式数 === 0 ? '<span class="tag red">缺</span>' : x.模式数}</td>
             <td>${x.城市风险数 !== t.城市 ? `<span class="tag gold">${x.城市风险数}/${t.城市}</span>` : x.城市风险数}</td></tr>`).join('')}</tbody></table></div>`
      : '<p class="hint" style="color:#059669">✓ 全部行业的职业、经营模式、城市风险三项数据均齐全。</p>'}
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
  const run = () => {
    const q = $('#gsQ').value.trim().toLowerCase();
    if (!q) return;
    $('#gsRes').innerHTML = '<div class="loading"><span class="spin"></span>检索中…</div>';

    const industries = getCollection('industries');
    const jobs = getCollection('jobs');
    const modes = getCollection('modes');
    const cityRisks = getCollection('city_risks');
    const cities = D.cities || [];

    const search = (arr, fields) => arr.map((r) => {
      const hits = fields.filter((f) => String(r[f] || '').toLowerCase().includes(q));
      return hits.length ? { rec: r, hitFields: hits } : null;
    }).filter(Boolean);

    const res = {
      industries: search(industries, F.industries_all).slice(0, 40).map((x) => ({
        key: x.rec['行业编号'],
        title: `${x.rec['行业编号']} ${x.rec['细分行业']}`,
        sub: x.rec['行业门类'],
        hitFields: x.hitFields,
      })),
      jobs: search(jobs, F.jobs_all).slice(0, 40).map((x) => ({
        key: x.rec['行业编号'] + '|' + x.rec['常见职位'],
        title: `${x.rec['行业编号']} ${x.rec['常见职位']}`,
        sub: x.rec['这个岗位每天干什么'] ? String(x.rec['这个岗位每天干什么']).slice(0, 60) : '',
        hitFields: x.hitFields,
      })),
      modes: search(modes, F.modes_all).slice(0, 40).map((x) => ({
        key: x.rec['行业编号'] + '|' + x.rec['细分模式'],
        title: `${x.rec['行业编号']} ${x.rec['细分模式']}`,
        sub: x.rec['运作方式'] ? String(x.rec['运作方式']).slice(0, 60) : '',
        hitFields: x.hitFields,
      })),
      city_risks: search(cityRisks, F.risks_all).slice(0, 40).map((x) => ({
        key: x.rec['行业编号'] + '|' + x.rec['城市'],
        title: `${x.rec['行业编号']} · ${x.rec['城市']}`,
        sub: x.rec['风险层级'],
        hitFields: x.hitFields,
      })),
      cities: search(cities, F.cities_all).slice(0, 40).map((x) => ({
        key: x.rec['城市名称'],
        title: x.rec['城市名称'],
        sub: x.rec['定位标签'],
        hitFields: x.hitFields,
      })),
    };

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
      ? `<p class="hint" style="margin-bottom:11px">关键词「<b>${esc(q)}</b>」共命中 <b>${total}</b> 条，点击可跳转到看板定位。</p>${h}`
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

// ================================================================== 数据导出
function pageTransfer(c) {
  const m = S.meta;
  c.innerHTML = `
  <div class="card">${cardHead('📤', '数据导出', '导出当前数据（含浏览器本地编辑）')}
    <div class="card-bd">
      <div class="btn-row">
        <button class="btn green" data-exp="all">导出全部数据</button>
        <button class="btn" data-exp="industries">行业档案 (${m.industry_count})</button>
        <button class="btn" data-exp="modes">经营模式 (${m.mode_count})</button>
        <button class="btn" data-exp="jobs">职业明细 (${m.job_count})</button>
        <button class="btn" data-exp="city_risks">城市风险 (${m.city_risk_count})</button>
        <button class="btn" data-exp="cities">城市 (${m.city_count})</button>
      </div>
      <p class="hint" style="margin-top:10px">导出为 UTF-8 JSON，包含浏览器本地保存的编辑内容。</p>
    </div></div>

  <div class="card">${cardHead('🧬', '数据来源说明', '')}
    <div class="card-bd">
      <table class="kv">
        <tr><th>源文件</th><td>${esc(m.source)}</td></tr>
        <tr><th>行业档案 / 前景利润</th><td><code>_idx</code> 表（99 个细分行业 × 16 个字段）</td></tr>
        <tr><th>经营模式</th><td><code>_m02</code> 表（${m.mode_count} 条模式）</td></tr>
        <tr><th>职业核实明细</th><td><code>_m04</code> 表（${m.job_count} 条）</td></tr>
        <tr><th>城市风险分级</th><td>99 行业 × 20 城市 = ${m.city_risk_count} 条</td></tr>
        <tr><th>城市清单</th><td>20 个城市</td></tr>
        <tr><th>部署方式</th><td>纯静态网站，GitHub Pages 托管，无后端依赖</td></tr>
        <tr><th>编辑存储</th><td>浏览器 localStorage（仅保存在当前浏览器，清除缓存后恢复原始数据）</td></tr>
      </table>
    </div></div>`;

  $$('[data-exp]').forEach((b) => { b.onclick = () => downloadJson(b.dataset.exp); });
}

// ================================================================== 页面路由注册
PAGES = {
  dashboard: pageDashboard, analytics: pageAnalytics, industries: pageIndustries,
  jobs: pageJobs, cityrisks: pageCityRisks, modes: pageModes,
  search: pageSearch, transfer: pageTransfer,
};

// ================================================================== 启动
function showApp() {
  $('#loginView').style.display = 'none';
  $('#appView').hidden = false;
  const dn = S.user.display_name || S.user.username;
  $('#userName').textContent = dn;
  $('#userRole').textContent = ROLE_NAME[S.user.role] || S.user.role;
  $('#userAvatar').textContent = dn.slice(0, 1).toUpperCase();
  if (S.meta) {
    $('#metaMini').innerHTML = `<b>${S.meta.industry_count}</b> 行业 · <b>${S.meta.job_count}</b> 职业<br>
      <b>${S.meta.city_count}</b> 城市 · <b>${S.meta.mode_count}</b> 模式<br>
      <span style="opacity:.75">源：${esc(S.meta.source)}</span>`;
  }
  renderNav();
  go(S.page || 'dashboard');
}

function doLogout() {
  S.user = null;
  localStorage.removeItem('xwk_user');
  $('#appView').hidden = true;
  $('#loginView').style.display = '';
  $('#loginPass').value = '';
}

$('#loginForm').onsubmit = (e) => {
  e.preventDefault();
  $('#loginErr').textContent = '';
  const u = $('#loginUser').value.trim();
  const p = $('#loginPass').value;
  const found = USERS.find((x) => x.username === u && x.password === p);
  if (!found) {
    $('#loginErr').textContent = '账号或密码错误';
    $('#loginPass').select();
    return;
  }
  S.user = { ...found };
  delete S.user.password;
  localStorage.setItem('xwk_user', JSON.stringify(S.user));
  showApp();
  toast('登录成功', `${S.user.display_name} · ${ROLE_NAME[S.user.role]}`);
};

$$('.usermenu button').forEach((b) => {
  b.onclick = (e) => {
    e.stopPropagation();
    $('.usermenu').classList.remove('show');
    if (b.dataset.act === 'logout') { if (confirm('确定退出登录？')) doLogout(); }
  };
});
$('.userbox').onclick = (e) => { e.stopPropagation(); $('.usermenu').classList.toggle('show'); };
document.addEventListener('click', () => $('.usermenu').classList.remove('show'));
$('#navToggle').onclick = () => $('.sidebar').classList.toggle('open');

// ------------------------------------------------------------------ 启动
initData();

(function boot() {
  const saved = localStorage.getItem('xwk_user');
  if (saved) {
    try {
      const u = JSON.parse(saved);
      const found = USERS.find((x) => x.username === u.username);
      if (found) {
        S.user = { ...found };
        delete S.user.password;
        showApp();
        return;
      }
    } catch (e) {}
  }
})();
