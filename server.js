/**
 * 小微行业知识库看板 V3 · Web 版
 * 后端：Express + node:sqlite（账号 / 权限 / 登录审计 / 内容编辑覆盖层）
 *
 * 数据源：小微行业知识库看板V3.xlsx
 *   行业档案 + 前景利润  ← _idx
 *   经营模式            ← _m02
 *   职业审核明细        ← _m04（+ 补写 19 个行业，共 99 行业全覆盖）
 *   城市风险分级        ← 00_整合明细 AF/AG 列（看板 05 区块公式的真实取值路径）
 *   城市清单            ← 22_城市选择·搜索勾选
 */
'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const { DatabaseSync } = require('node:sqlite');

const ROOT = __dirname;
// 数据目录可用 DATA_DIR 覆盖（云平台挂持久卷时使用）
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
const DB_PATH = path.join(DATA_DIR, 'xwk.db');
const SEED_PATH = path.join(ROOT, 'data', 'seed.json');
const PORT = Number(process.env.PORT || 3210);
const HOST = process.env.HOST || '0.0.0.0';

const persist = require('./persistence');

// ---------------------------------------------------------------- 基础数据
if (!fs.existsSync(SEED_PATH)) {
  console.error('[致命] 缺少数据文件:', SEED_PATH);
  process.exit(1);
}
const SEED = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));

const COLLECTIONS = {
  industries: { key: (r) => r['行业编号'], label: '行业档案' },
  modes: { key: (r) => r['行业编号'] + '|' + r['细分模式'], label: '经营模式' },
  jobs: { key: (r) => r['行业编号'] + '|' + r['常见职位'], label: '职业审核明细' },
  cities: { key: (r) => r['城市名称'], label: '城市' },
  city_risks: { key: (r) => r['行业编号'] + '|' + r['城市'], label: '城市风险分级' },
};

// ---------------------------------------------------------------- 数据库
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL DEFAULT '',
  pass_salt     TEXT NOT NULL,
  pass_hash     TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'viewer',
  can_view      INTEGER NOT NULL DEFAULT 1,
  can_edit      INTEGER NOT NULL DEFAULT 0,
  can_manage    INTEGER NOT NULL DEFAULT 0,
  enabled       INTEGER NOT NULL DEFAULT 1,
  must_change   INTEGER NOT NULL DEFAULT 0,
  is_builtin    INTEGER NOT NULL DEFAULT 0,
  remark        TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL,
  created_by    TEXT NOT NULL DEFAULT 'system',
  last_login_at TEXT,
  last_login_ip TEXT,
  last_login_ua TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL,
  username    TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  ip          TEXT NOT NULL DEFAULT '',
  user_agent  TEXT NOT NULL DEFAULT '',
  revoked_at  TEXT
);

CREATE TABLE IF NOT EXISTS login_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  username    TEXT NOT NULL,
  user_id     INTEGER,
  ok          INTEGER NOT NULL,
  reason      TEXT NOT NULL DEFAULT '',
  ip          TEXT NOT NULL DEFAULT '',
  ip_public   TEXT NOT NULL DEFAULT '',
  device      TEXT NOT NULL DEFAULT '',
  browser     TEXT NOT NULL DEFAULT '',
  os_name     TEXT NOT NULL DEFAULT '',
  user_agent  TEXT NOT NULL DEFAULT '',
  at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  username    TEXT NOT NULL,
  action      TEXT NOT NULL,
  collection  TEXT NOT NULL DEFAULT '',
  target      TEXT NOT NULL DEFAULT '',
  field       TEXT NOT NULL DEFAULT '',
  old_value   TEXT,
  new_value   TEXT,
  ip          TEXT NOT NULL DEFAULT '',
  at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS content_overrides (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  collection  TEXT NOT NULL,
  rec_key     TEXT NOT NULL,
  field       TEXT NOT NULL,
  value       TEXT,
  updated_by  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE(collection, rec_key, field)
);

CREATE TABLE IF NOT EXISTS site_settings (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL DEFAULT ''
);
`);

// ---------------------------------------------------------------- 密码
function hashPassword(pw, salt) {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const h = crypto.scryptSync(String(pw), s, 64).toString('hex');
  return { salt: s, hash: h };
}
function verifyPassword(pw, salt, hash) {
  try {
    const h = crypto.scryptSync(String(pw), salt, 64).toString('hex');
    const a = Buffer.from(h, 'hex');
    const b = Buffer.from(String(hash), 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

const nowIso = () => new Date().toISOString();

// 轻量迁移：老库若缺 is_builtin 列则补上
try {
  const cols = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
  if (!cols.includes('is_builtin')) db.exec('ALTER TABLE users ADD COLUMN is_builtin INTEGER NOT NULL DEFAULT 0');
} catch { /* 忽略 */ }

// 初始超级管理员
function ensureSuperAdmin() {
  const row = db.prepare('SELECT COUNT(*) AS n FROM users').get();
  if (row.n > 0) return;
  const { salt, hash } = hashPassword('wt1201263');
  db.prepare(`INSERT INTO users
    (username, display_name, pass_salt, pass_hash, role, can_view, can_edit, can_manage, enabled, must_change, is_builtin, remark, created_at, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'system')`).run(
    'gaoyuxi', '超级管理员', salt, hash, 'super_admin', 1, 1, 1, 1, 1, 1,
    '系统内置超级管理员，首次登录后请立即修改密码', nowIso()
  );
  console.log('[初始化] 已创建内置超级管理员 gaoyuxi（不可删除/降级/停用）');
}
ensureSuperAdmin();

// ---------------------------------------------------------------- 工具
function parseUA(ua) {
  ua = String(ua || '');
  let browser = '未知浏览器';
  if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/OPR\//i.test(ua)) browser = 'Opera';
  else if (/Chrome\//i.test(ua)) browser = 'Chrome';
  else if (/Firefox\//i.test(ua)) browser = 'Firefox';
  else if (/Safari\//i.test(ua)) browser = 'Safari';

  let os_name = '未知系统';
  if (/Windows NT 10/i.test(ua)) os_name = 'Windows 10/11';
  else if (/Windows/i.test(ua)) os_name = 'Windows';
  else if (/Mac OS X/i.test(ua)) os_name = 'macOS';
  else if (/Android/i.test(ua)) os_name = 'Android';
  else if (/iPhone|iPad|iPod/i.test(ua)) os_name = 'iOS';
  else if (/Linux/i.test(ua)) os_name = 'Linux';

  let device = '桌面端';
  if (/Mobi|Android|iPhone|iPad|iPod/i.test(ua)) device = '移动端';
  else if (/Tablet|iPad/i.test(ua)) device = '平板';

  return { browser, os_name, device };
}

function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (xf) return String(xf).split(',')[0].trim();
  const real = req.headers['x-real-ip'];
  if (real) return String(real).trim();
  const s = req.socket && req.socket.remoteAddress ? String(req.socket.remoteAddress) : '';
  return s.replace(/^::ffff:/, '');
}

function isPublicIp(ip) {
  if (!ip) return false;
  if (/^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)) return false;
  if (ip === '::1' || ip === 'localhost' || ip.startsWith('fc') || ip.startsWith('fd')) return false;
  return true;
}

function logLogin(username, userId, ok, reason, req) {
  const ua = req.headers['user-agent'] || '';
  const p = parseUA(ua);
  const ip = clientIp(req);
  db.prepare(`INSERT INTO login_log
    (username, user_id, ok, reason, ip, ip_public, device, browser, os_name, user_agent, at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    String(username || ''), userId || null, ok ? 1 : 0, reason || '',
    ip, isPublicIp(ip) ? ip : '', p.device, p.browser, p.os_name, String(ua).slice(0, 500), nowIso()
  );
}

function logAudit(user, action, collection, target, field, oldVal, newVal, req) {
  db.prepare(`INSERT INTO audit_log
    (username, action, collection, target, field, old_value, new_value, ip, at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
    user ? user.username : 'anonymous', action, collection || '', String(target || ''),
    field || '', oldVal == null ? null : String(oldVal), newVal == null ? null : String(newVal),
    req ? clientIp(req) : '', nowIso()
  );
}

// ---------------------------------------------------------------- 数据装配（seed + 覆盖层）
function loadCollection(name) {
  const base = SEED[name] || [];
  const rows = db.prepare('SELECT rec_key, field, value FROM content_overrides WHERE collection = ?').all(name);
  if (!rows.length) return base.map((r) => ({ ...r }));

  const keyFn = COLLECTIONS[name].key;
  const ov = new Map();
  for (const r of rows) {
    if (!ov.has(r.rec_key)) ov.set(r.rec_key, {});
    ov.get(r.rec_key)[r.field] = r.value;
  }
  return base.map((r) => {
    const k = keyFn(r);
    return ov.has(k) ? { ...r, ...ov.get(k) } : { ...r };
  });
}

const DATA = {};
function refreshData() {
  for (const n of Object.keys(COLLECTIONS)) DATA[n] = loadCollection(n);
  // 索引
  DATA._industryByCode = new Map(DATA.industries.map((r) => [r['行业编号'], r]));
  DATA._modesByCode = new Map();
  for (const m of DATA.modes) {
    if (!DATA._modesByCode.has(m['行业编号'])) DATA._modesByCode.set(m['行业编号'], []);
    DATA._modesByCode.get(m['行业编号']).push(m);
  }
  DATA._jobsByCode = new Map();
  for (const j of DATA.jobs) {
    if (!DATA._jobsByCode.has(j['行业编号'])) DATA._jobsByCode.set(j['行业编号'], []);
    DATA._jobsByCode.get(j['行业编号']).push(j);
  }
  DATA._riskByCode = new Map();
  for (const c of DATA.city_risks) {
    if (!DATA._riskByCode.has(c['行业编号'])) DATA._riskByCode.set(c['行业编号'], []);
    DATA._riskByCode.get(c['行业编号']).push(c);
  }
}
refreshData();

// ---------------------------------------------------------------- 看板查询引擎（严格复刻 Excel 公式）
/**
 * 复刻 20_行业选择·搜索勾选：
 *   E列 检索串 = LOWER(编号 + 门类 + 细分行业 + _idx D..P + 职业标签串)
 *   G列 命中   = 检索词为空 → 1；否则 SEARCH(检索词, 检索串) 命中 → 1
 *   检索词     = SUBSTITUTE(TRIM(输入), "-", " ")
 *   N6 定位    = 勾选优先 → 精确编号 → 精确三段式标签 → 唯一命中
 */
function buildIndustrySearchIndex() {
  const idxFields = ['行业编号', '行业门类', '细分行业', '典型经营主体形态', '必备证照资质',
    '常见经营规模', '订单与客户来源', '典型融资用途', '前景趋势判断', '毛利率区间',
    '净利率区间', '旺季月份', '淡季月份', '季节性资金缺口高峰', '主要经营风险',
    '政策与外部驱动', '职业标签串'];
  const m = new Map();
  for (const ind of DATA.industries) {
    const parts = idxFields.map((f) => ind[f] || '');
    // 追加该行业的职业名，使「按岗位搜行业」成立（与 _idx Y列职业标签串一致）
    const jobs = DATA._jobsByCode.get(ind['行业编号']) || [];
    for (const j of jobs) parts.push(j['常见职位'] || '');
    m.set(ind['行业编号'], {
      code: ind['行业编号'],
      cat: ind['行业门类'],
      name: ind['细分行业'],
      label: `${ind['行业编号']}-${ind['行业门类']}-${ind['细分行业']}`,
      hay: parts.join(' ').toLowerCase(),
    });
  }
  return m;
}
let IND_SEARCH = buildIndustrySearchIndex();

function normalizeKw(v) {
  return String(v == null ? '' : v).trim().replace(/-/g, ' ');
}

function searchIndustries(keyword) {
  const kw = normalizeKw(keyword).toLowerCase();
  const out = [];
  for (const rec of IND_SEARCH.values()) {
    if (!kw || rec.hay.includes(kw)) out.push(rec);
  }
  return out;
}

/** 复刻 20表 N6：定位唯一行业编号 */
function resolveIndustryCode(keyword, checkedCodes) {
  // 1) 勾选优先（取第一个勾选且命中的）
  if (checkedCodes && checkedCodes.length) {
    const hits = new Set(searchIndustries(keyword).map((r) => r.code));
    for (const c of checkedCodes) if (hits.has(c)) return c;
    for (const c of checkedCodes) if (IND_SEARCH.has(c)) return c;
    return '';
  }
  const raw = String(keyword == null ? '' : keyword).trim();
  if (!raw) return '';
  // 2) 精确编号
  if (IND_SEARCH.has(raw.toUpperCase())) return raw.toUpperCase();
  // 3) 精确三段式标签
  for (const rec of IND_SEARCH.values()) if (rec.label === raw) return rec.code;
  // 4) 唯一命中
  const hits = searchIndustries(raw);
  if (hits.length === 1) return hits[0].code;
  return '';
}

/**
 * 复刻 _m21 + 21表：职业显示逻辑
 *   F 本行业 = (编号 == 当前行业)
 *   G 关键词命中 = 检索词空→1；否则 SEARCH(检索词, LOWER(编号+行业名+职位))
 *   I 有效勾选 = G==1 且 职位在勾选列表中
 *   K 是否显示 = G!=1 → 0；否则 (存在任意勾选 ? I : 1)
 *   L 显示序号 = K 的累加；看板最多显示 10 条
 */
function resolveJobs(code, jobKeyword, checkedJobs, limit = 10) {
  if (!code) return { total: 0, hit: 0, checked: 0, shown: [], all: [] };
  const all = DATA._jobsByCode.get(code) || [];
  const kw = normalizeKw(jobKeyword).toLowerCase();
  const ind = IND_SEARCH.get(code) || { name: '', cat: '' };

  const checkedSet = new Set((checkedJobs || []).map((s) => String(s).trim()));
  const rows = [];
  let hit = 0, checkedHit = 0;

  all.forEach((j, i) => {
    const jobName = String(j['常见职位'] || '').trim();
    const hay = `${code} ${ind.name} ${jobName}`.toLowerCase();
    const g = (!kw || hay.includes(kw)) ? 1 : 0;
    const isChecked = g === 1 && checkedSet.has(jobName) ? 1 : 0;
    if (g) hit++;
    if (isChecked) checkedHit++;
    rows.push({ idx: i, job: j, jobName, g, isChecked, hay });
  });

  const anyChecked = checkedHit > 0;
  let seq = 0;
  const shown = [];
  for (const r of rows) {
    const k = r.g !== 1 ? 0 : (anyChecked ? r.isChecked : 1);
    r.k = k;
    if (k === 1) {
      seq++;
      r.seq = seq;
      if (seq <= limit) shown.push(r);
    } else {
      r.seq = null;
    }
  }
  return {
    total: all.length,
    hit,
    checked: checkedHit,
    shownCount: seq,
    shown: shown.map((r) => r.job),
    all: rows.map((r) => ({
      行业编号: code,
      常见职位: r.jobName,
      行业名称: ind.name,
      三段式标签: `${code}-${ind.name}-${r.jobName}`,
      命中: r.g,
      已勾选: r.isChecked,
      是否显示: r.k,
      显示序号: r.seq,
      明细: r.job,
    })),
  };
}

/**
 * 复刻 22表 + 看板 05 区块：城市显示逻辑
 *   H 命中 = 检索词空→1；否则 SEARCH(检索词, 城市名+定位标签+三段式标签)
 *   J 有效勾选 = H==1 且 已勾选
 *   L 是否显示 = H!=1→0；否则 (存在勾选 ? J : 1)
 *   M 显示序号 = L 累加；看板最多显示 8 行
 *   N/O 层级与依据 ← 00_整合明细（按 行业编号+城市名 匹配）
 */
function resolveCities(code, cityKeyword, checkedCities, limit = 8) {
  const kw = normalizeKw(cityKeyword).toLowerCase();
  const checkedSet = new Set((checkedCities || []).map((s) => String(s).trim()));
  const riskRows = code ? (DATA._riskByCode.get(code) || []) : [];
  const riskMap = new Map(riskRows.map((r) => [r['城市'], r]));

  const rows = [];
  let hit = 0, checkedHit = 0;
  DATA.cities.forEach((c) => {
    const name = String(c['城市名称'] || '').trim();
    const label = `${c['序号']}-${name}-${c['定位标签'] || ''}`;
    const hay = `${name} ${c['定位标签'] || ''} ${label}`.toLowerCase();
    const h = (!kw || hay.includes(kw)) ? 1 : 0;
    const j = h === 1 && checkedSet.has(name) ? 1 : 0;
    if (h) hit++;
    if (j) checkedHit++;
    rows.push({ city: c, name, h, j });
  });

  const anyChecked = checkedHit > 0;
  let seq = 0;
  const shown = [];
  for (const r of rows) {
    const l = r.h !== 1 ? 0 : (anyChecked ? r.j : 1);
    r.l = l;
    if (l === 1) {
      seq++;
      r.seq = seq;
      if (seq <= limit) {
        const rk = riskMap.get(r.name);
        shown.push({
          城市: r.name,
          定位标签: r.city['定位标签'] || '',
          风险层级: rk ? rk['风险层级'] : (code ? '—' : ''),
          依据与尽调要点: rk ? rk['依据与尽调要点'] : (code ? '' : ''),
          显示序号: seq,
        });
      }
    } else {
      r.seq = null;
    }
  }
  return {
    total: DATA.cities.length, hit, checked: checkedHit, shownCount: seq,
    shown,
    all: rows.map((r) => ({
      序号: r.city['序号'], 城市名称: r.name, 定位标签: r.city['定位标签'] || '',
      命中: r.h, 已勾选: r.j, 是否显示: r.l, 显示序号: r.seq,
    })),
  };
}

/** 组装完整看板（等价于打开 Excel 看板并按 F9 重算） */
function buildDashboard(q) {
  const indKw = String(q.industry || '');
  const jobKw = String(q.job || '');
  const cityKw = String(q.city || '');
  const checkedInd = Array.isArray(q.checkedIndustries) ? q.checkedIndustries : [];
  const checkedJob = Array.isArray(q.checkedJobs) ? q.checkedJobs : [];
  const checkedCity = Array.isArray(q.checkedCities) ? q.checkedCities : [];

  const code = resolveIndustryCode(indKw, checkedInd);
  const hits = searchIndustries(indKw);
  const ind = code ? DATA._industryByCode.get(code) : null;

  const modes = code ? (DATA._modesByCode.get(code) || []) : [];
  const jobRes = resolveJobs(code, jobKw, checkedJob, 10);
  const cityRes = resolveCities(code, cityKw, checkedCity, 8);

  // 状态文案（复刻 20表N10 / 21表K9 / 22表S7）
  let indStatus;
  if (code) indStatus = `已定位：${IND_SEARCH.get(code).label}`;
  else if (!indKw.trim()) indStatus = '未输入关键词：请勾选候选行业，或在行业查询框输入';
  else if (hits.length === 0) indStatus = '无命中，请更换关键词（支持编号/行业名/门类/岗位/证照）';
  else indStatus = `命中 ${hits.length} 条，请勾选其一或细化关键词`;

  let jobStatus;
  if (!code) jobStatus = '请先选定行业（职业列表随行业联动，只列该行业职位）';
  else if (jobRes.total === 0) jobStatus = '该行业暂无职位数据';
  else if (jobRes.hit === 0) jobStatus = `本行业共 ${jobRes.total} 个职位，无匹配关键词，请修改职业搜索词`;
  else jobStatus = `本行业职位 ${jobRes.total} 个｜命中 ${jobRes.hit} 个｜看板显示 ${jobRes.shownCount} 个（`
    + (jobRes.checked === 0 ? '未勾选：显示全部命中' : `已勾选 ${jobRes.checked} 项：仅显示勾选项`) + '）';

  let cityStatus;
  if (cityRes.checked > 0) cityStatus = `已勾选 ${cityRes.checked} 个城市｜命中 ${cityRes.hit} 个｜看板显示 ${cityRes.shownCount} 个`;
  else if (cityKw.trim()) cityStatus = `命中 ${cityRes.hit} 个城市｜看板显示 ${cityRes.shownCount} 个（未勾选：显示全部命中）`;
  else cityStatus = `共 ${cityRes.total} 个城市｜看板显示前 ${cityRes.shownCount} 个（可勾选或输入关键词筛选）`;

  return {
    query: { industry: indKw, job: jobKw, city: cityKw },
    resolvedCode: code,
    industry: ind || null,
    industryLabel: ind ? `${ind['行业编号']}-${ind['行业门类']}-${ind['细分行业']}` : '',
    candidates: hits.slice(0, 6).map((h) => h.label),
    candidateTotal: hits.length,
    checkedIndustries: checkedInd,
    modes,
    jobs: jobRes,
    cities: cityRes,
    status: { industry: indStatus, job: jobStatus, city: cityStatus },
  };
}

// ---------------------------------------------------------------- 鉴权中间件
const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '32mb' }));
app.use(express.urlencoded({ extended: true, limit: '32mb' }));

// 所有成功的写操作（POST/PUT/DELETE/PATCH）后触发一次节流快照
// scheduleSave 在下方定义，此处用闭包延迟调用
app.use((req, res, next) => {
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    res.on('finish', () => {
      if (res.statusCode >= 200 && res.statusCode < 300 && typeof scheduleSave === 'function') scheduleSave();
    });
  }
  next();
});

function getSession(req) {
  let token = null;
  const auth = req.headers['authorization'];
  if (auth && /^Bearer\s+/i.test(auth)) token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token && req.headers.cookie) {
    const m = req.headers.cookie.split(/;\s*/).find((c) => c.startsWith('xwk_token='));
    if (m) token = decodeURIComponent(m.slice('xwk_token='.length));
  }
  if (!token) return null;
  const s = db.prepare(`SELECT s.*, u.display_name, u.role, u.can_view, u.can_edit, u.can_manage, u.enabled, u.must_change
      FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ? AND s.revoked_at IS NULL AND s.expires_at > ?`).get(token, nowIso());
  if (!s) return null;
  if (!s.enabled) return null;
  return { token, ...s };
}

function requireAuth(req, res, next) {
  const s = getSession(req);
  if (!s) return res.status(401).json({ ok: false, error: '未登录或会话已过期' });
  req.session = s;
  req.user = {
    id: s.user_id, username: s.username, display_name: s.display_name, role: s.role,
    can_view: !!s.can_view, can_edit: !!s.can_edit, can_manage: !!s.can_manage,
  };
  next();
}
function requireEdit(req, res, next) {
  if (!req.user.can_edit) return res.status(403).json({ ok: false, error: '无页面编辑权限，请联系超级管理员授权' });
  next();
}
function requireManage(req, res, next) {
  if (!req.user.can_manage) return res.status(403).json({ ok: false, error: '无账号管理权限，仅超级管理员可操作' });
  next();
}

// ---------------------------------------------------------------- 路由：认证
app.post('/api/login', (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  if (!username || !password) {
    logLogin(username, null, false, '用户名或密码为空', req);
    return res.status(400).json({ ok: false, error: '请输入用户名和密码' });
  }
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!u || !verifyPassword(password, u.pass_salt, u.pass_hash)) {
    logLogin(username, u ? u.id : null, false, '用户名或密码错误', req);
    return res.status(401).json({ ok: false, error: '用户名或密码错误' });
  }
  if (!u.enabled) {
    logLogin(username, u.id, false, '账号已停用', req);
    return res.status(403).json({ ok: false, error: '账号已停用，请联系超级管理员' });
  }

  const token = crypto.randomBytes(32).toString('hex');
  const exp = new Date(Date.now() + 12 * 3600 * 1000).toISOString();
  const ip = clientIp(req);
  const ua = String(req.headers['user-agent'] || '').slice(0, 500);
  db.prepare('INSERT INTO sessions (token, user_id, username, created_at, expires_at, ip, user_agent) VALUES (?,?,?,?,?,?,?)')
    .run(token, u.id, u.username, nowIso(), exp, ip, ua);
  db.prepare('UPDATE users SET last_login_at=?, last_login_ip=?, last_login_ua=? WHERE id=?')
    .run(nowIso(), ip, ua, u.id);
  logLogin(username, u.id, true, '', req);

  res.setHeader('Set-Cookie', `xwk_token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${12 * 3600}`);
  res.json({
    ok: true,
    user: {
      username: u.username, display_name: u.display_name, role: u.role,
      can_view: !!u.can_view, can_edit: !!u.can_edit, can_manage: !!u.can_manage,
      must_change: !!u.must_change,
    },
    token,
    expires_at: exp,
  });
});

app.post('/api/logout', (req, res) => {
  const s = getSession(req);
  if (s) {
    db.prepare('UPDATE sessions SET revoked_at=? WHERE token=?').run(nowIso(), s.token);
    logAudit({ username: s.username }, '登出', '', '', '', null, null, req);
  }
  res.setHeader('Set-Cookie', 'xwk_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ ok: true, user: req.user });
});

app.post('/api/change-password', requireAuth, (req, res) => {
  const oldPw = String(req.body.old_password || '');
  const newPw = String(req.body.new_password || '');
  if (newPw.length < 8) return res.status(400).json({ ok: false, error: '新密码至少 8 位' });
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!verifyPassword(oldPw, u.pass_salt, u.pass_hash)) {
    return res.status(400).json({ ok: false, error: '原密码错误' });
  }
  const { salt, hash } = hashPassword(newPw);
  db.prepare('UPDATE users SET pass_salt=?, pass_hash=?, must_change=0 WHERE id=?').run(salt, hash, u.id);
  logAudit(req.user, '修改自己的密码', 'users', u.username, '', null, null, req);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- 路由：看板与数据
app.get('/api/dashboard', requireAuth, (req, res) => {
  const q = {
    industry: req.query.industry || '',
    job: req.query.job || '',
    city: req.query.city || '',
    checkedIndustries: req.query.ci ? String(req.query.ci).split('|').filter(Boolean) : [],
    checkedJobs: req.query.cj ? String(req.query.cj).split('|').filter(Boolean) : [],
    checkedCities: req.query.cc ? String(req.query.cc).split('|').filter(Boolean) : [],
  };
  res.json({ ok: true, data: buildDashboard(q) });
});

app.get('/api/meta', requireAuth, (req, res) => {
  const cats = {};
  for (const i of DATA.industries) cats[i['行业门类']] = (cats[i['行业门类']] || 0) + 1;
  res.json({
    ok: true,
    meta: {
      source: SEED.meta.source,
      industry_count: DATA.industries.length,
      mode_count: DATA.modes.length,
      job_count: DATA.jobs.length,
      city_count: DATA.cities.length,
      city_risk_count: DATA.city_risks.length,
      categories: cats,
      cities: DATA.cities.map((c) => ({ 序号: c['序号'], 城市名称: c['城市名称'], 定位标签: c['定位标签'] })),
      supplemented_19: SEED.meta.supplemented_19 || [],
    },
    fields: {
      industries: Object.keys(DATA.industries[0] || {}),
      modes: Object.keys(DATA.modes[0] || {}),
      jobs: Object.keys(DATA.jobs[0] || {}),
      city_risks: Object.keys(DATA.city_risks[0] || {}),
    },
  });
});

app.get('/api/collection/:name', requireAuth, (req, res) => {
  const name = req.params.name;
  if (!COLLECTIONS[name]) return res.status(404).json({ ok: false, error: '未知数据集' });
  let rows = DATA[name];
  const kw = String(req.query.q || '').trim().toLowerCase();
  const code = String(req.query.code || '').trim();
  if (code) rows = rows.filter((r) => r['行业编号'] === code || r['城市名称'] === code);
  if (kw) rows = rows.filter((r) => JSON.stringify(r).toLowerCase().includes(kw));
  const page = Math.max(1, Number(req.query.page || 1));
  const size = Math.min(2000, Math.max(1, Number(req.query.size || 200)));
  const start = (page - 1) * size;
  res.json({ ok: true, total: rows.length, page, size, rows: rows.slice(start, start + size) });
});

// 编辑：写入覆盖层（保留原始 seed 数据，可追溯可还原）
app.put('/api/collection/:name/record', requireAuth, requireEdit, (req, res) => {
  const name = req.params.name;
  if (!COLLECTIONS[name]) return res.status(404).json({ ok: false, error: '未知数据集' });
  const { rec_key, changes } = req.body || {};
  if (!rec_key || !changes || typeof changes !== 'object') {
    return res.status(400).json({ ok: false, error: '缺少 rec_key 或 changes' });
  }
  const base = (SEED[name] || []).find((r) => COLLECTIONS[name].key(r) === rec_key);
  if (!base) return res.status(404).json({ ok: false, error: '记录不存在' });

  const allowed = new Set(Object.keys(base));
  const at = nowIso();
  const stmt = db.prepare(`INSERT INTO content_overrides (collection, rec_key, field, value, updated_by, updated_at)
      VALUES (?,?,?,?,?,?)
      ON CONFLICT(collection, rec_key, field) DO UPDATE SET value=excluded.value, updated_by=excluded.updated_by, updated_at=excluded.updated_at`);
  let n = 0;
  for (const [f, v] of Object.entries(changes)) {
    if (!allowed.has(f)) continue;
    const nv = v == null ? '' : String(v);
    const ov = db.prepare('SELECT value FROM content_overrides WHERE collection=? AND rec_key=? AND field=?').get(name, rec_key, f);
    const oldEffective = ov ? ov.value : (base[f] == null ? '' : String(base[f]));
    if (oldEffective === nv) continue;
    stmt.run(name, rec_key, f, nv, req.user.username, at);
    logAudit(req.user, '编辑内容', name, rec_key, f, oldEffective, nv, req);
    n++;
  }
  refreshData();
  IND_SEARCH = buildIndustrySearchIndex();
  res.json({ ok: true, updated: n });
});

app.post('/api/collection/:name/record', requireAuth, requireEdit, (req, res) => {
  const name = req.params.name;
  if (!COLLECTIONS[name]) return res.status(404).json({ ok: false, error: '未知数据集' });
  const rec = req.body && req.body.record;
  if (!rec || typeof rec !== 'object') return res.status(400).json({ ok: false, error: '缺少 record' });

  const tpl = Object.keys((SEED[name] || [{}])[0] || {});
  const newRec = {};
  for (const f of tpl) newRec[f] = rec[f] == null ? '' : String(rec[f]);
  const key = COLLECTIONS[name].key(newRec);
  if (!key || key.startsWith('|')) return res.status(400).json({ ok: false, error: '关键字段（行业编号/职位/城市）不能为空' });
  if ((SEED[name] || []).some((r) => COLLECTIONS[name].key(r) === key)) {
    return res.status(409).json({ ok: false, error: '记录已存在，请直接编辑' });
  }
  SEED[name].push(newRec);
  const at = nowIso();
  for (const [f, v] of Object.entries(newRec)) {
    db.prepare(`INSERT INTO content_overrides (collection, rec_key, field, value, updated_by, updated_at)
        VALUES (?,?,?,?,?,?)
        ON CONFLICT(collection, rec_key, field) DO UPDATE SET value=excluded.value, updated_by=excluded.updated_by, updated_at=excluded.updated_at`)
      .run(name, key, f, v, req.user.username, at);
  }
  db.prepare(`INSERT INTO site_settings (k, v) VALUES ('added_' || ?, ?)
      ON CONFLICT(k) DO UPDATE SET v = excluded.v`).run(name + '|' + key, JSON.stringify(newRec));
  logAudit(req.user, '新增记录', name, key, '', null, JSON.stringify(newRec).slice(0, 2000), req);
  refreshData();
  IND_SEARCH = buildIndustrySearchIndex();
  res.json({ ok: true, key });
});

app.delete('/api/collection/:name/record', requireAuth, requireEdit, (req, res) => {
  const name = req.params.name;
  if (!COLLECTIONS[name]) return res.status(404).json({ ok: false, error: '未知数据集' });
  const rec_key = String(req.query.rec_key || '');
  if (!rec_key) return res.status(400).json({ ok: false, error: '缺少 rec_key' });

  const i = (SEED[name] || []).findIndex((r) => COLLECTIONS[name].key(r) === rec_key);
  if (i < 0) return res.status(404).json({ ok: false, error: '记录不存在' });
  const removed = SEED[name].splice(i, 1)[0];
  db.prepare('DELETE FROM content_overrides WHERE collection=? AND rec_key=?').run(name, rec_key);
  db.prepare(`INSERT INTO site_settings (k, v) VALUES ('deleted_' || ?, ?)
      ON CONFLICT(k) DO UPDATE SET v = excluded.v`).run(name + '|' + rec_key, JSON.stringify(removed));
  logAudit(req.user, '删除记录', name, rec_key, '', JSON.stringify(removed).slice(0, 2000), null, req);
  refreshData();
  IND_SEARCH = buildIndustrySearchIndex();
  res.json({ ok: true });
});

/** 还原某条记录到 Excel 原始值 */
app.post('/api/collection/:name/record/revert', requireAuth, requireEdit, (req, res) => {
  const name = req.params.name;
  if (!COLLECTIONS[name]) return res.status(404).json({ ok: false, error: '未知数据集' });
  const rec_key = String((req.body || {}).rec_key || '');
  if (!rec_key) return res.status(400).json({ ok: false, error: '缺少 rec_key' });
  const r = db.prepare('DELETE FROM content_overrides WHERE collection=? AND rec_key=?').run(name, rec_key);
  logAudit(req.user, '还原为原始值', name, rec_key, '', null, null, req);
  refreshData();
  IND_SEARCH = buildIndustrySearchIndex();
  res.json({ ok: true, reverted: r.changes });
});

/** 当前记录的覆盖详情（哪些字段被谁在何时改过） */
app.get('/api/collection/:name/overrides', requireAuth, (req, res) => {
  const name = req.params.name;
  if (!COLLECTIONS[name]) return res.status(404).json({ ok: false, error: '未知数据集' });
  const rec_key = String(req.query.rec_key || '');
  const rows = rec_key
    ? db.prepare('SELECT field, value, updated_by, updated_at FROM content_overrides WHERE collection=? AND rec_key=? ORDER BY field').all(name, rec_key)
    : db.prepare('SELECT rec_key, field, value, updated_by, updated_at FROM content_overrides WHERE collection=? ORDER BY rec_key, field').all(name);
  res.json({ ok: true, rows });
});

// ---------------------------------------------------------------- 路由：统计
app.get('/api/analytics', requireAuth, (req, res) => {
  const cats = {};
  for (const i of DATA.industries) {
    const c = i['行业门类'] || '未分类';
    if (!cats[c]) cats[c] = { 行业数: 0, 编号: [] };
    cats[c].行业数++;
    cats[c].编号.push(i['行业编号']);
  }

  const cityNames = DATA.cities.map((c) => c['城市名称']);
  const levelOrder = ['A级', 'B-C级', 'B级', 'C级', 'C-D级', 'D级', 'E级'];
  const byCity = {};
  for (const cn of cityNames) byCity[cn] = {};
  const byLevelAll = {};
  const highRisk = [];
  for (const r of DATA.city_risks) {
    const lv = String(r['风险层级'] || '未分级');
    byCity[r['城市']][lv] = (byCity[r['城市']][lv] || 0) + 1;
    byLevelAll[lv] = (byLevelAll[lv] || 0) + 1;
    if (/^[D-E]/.test(lv) || lv.startsWith('D') || lv.startsWith('E')) {
      highRisk.push({ 行业编号: r['行业编号'], 城市: r['城市'], 风险层级: lv, 依据: r['依据与尽调要点'] });
    }
  }

  const jobsPerIndustry = {};
  for (const j of DATA.jobs) jobsPerIndustry[j['行业编号']] = (jobsPerIndustry[j['行业编号']] || 0) + 1;
  const modesPerIndustry = {};
  for (const m of DATA.modes) modesPerIndustry[m['行业编号']] = (modesPerIndustry[m['行业编号']] || 0) + 1;

  // 行业风险指数：20城层级平均（越高风险越大）
  const lvScore = { 'A级': 1, 'B-C级': 2, 'B级': 2, 'C级': 3, 'C-D级': 4, 'D级': 5, 'E级': 6 };
  const indRisk = [];
  for (const i of DATA.industries) {
    const rs = DATA._riskByCode.get(i['行业编号']) || [];
    let sum = 0, n = 0;
    for (const r of rs) {
      const k = Object.keys(lvScore).find((x) => String(r['风险层级']).startsWith(x.replace('级', '')));
      if (k) { sum += lvScore[k]; n++; }
    }
    indRisk.push({
      行业编号: i['行业编号'], 行业门类: i['行业门类'], 细分行业: i['细分行业'],
      风险指数: n ? Number((sum / n).toFixed(2)) : null,
      城市数: n,
      最高风险城市: (rs.slice().sort((a, b) => (lvScore[Object.keys(lvScore).find(x => String(b['风险层级']).startsWith(x.replace('级','')))] || 0)
        - (lvScore[Object.keys(lvScore).find(x => String(a['风险层级']).startsWith(x.replace('级','')))] || 0))[0] || {})['城市'] || '',
    });
  }
  indRisk.sort((a, b) => (b.风险指数 || 0) - (a.风险指数 || 0));

  // 覆盖完整性
  const coverage = DATA.industries.map((i) => ({
    行业编号: i['行业编号'],
    细分行业: i['细分行业'],
    职业数: jobsPerIndustry[i['行业编号']] || 0,
    模式数: modesPerIndustry[i['行业编号']] || 0,
    城市风险数: (DATA._riskByCode.get(i['行业编号']) || []).length,
  }));

  res.json({
    ok: true,
    data: {
      totals: {
        行业: DATA.industries.length, 门类: Object.keys(cats).length,
        经营模式: DATA.modes.length, 职业: DATA.jobs.length,
        城市: cityNames.length, 城市风险记录: DATA.city_risks.length,
      },
      categories: cats,
      riskByCity: byCity,
      riskByLevel: byLevelAll,
      levelOrder,
      highRisk,
      industryRisk: indRisk,
      coverage,
      jobsPerIndustry,
      modesPerIndustry,
    },
  });
});

// ---------------------------------------------------------------- 路由：全局搜索
app.get('/api/search', requireAuth, (req, res) => {
  const kw = String(req.query.q || '').trim();
  if (!kw) return res.json({ ok: true, results: [] });
  const low = kw.toLowerCase();
  const out = { industries: [], modes: [], jobs: [], cities: [], city_risks: [] };
  const cap = 40;

  for (const r of DATA.industries) {
    if (out.industries.length >= cap) break;
    const hitF = Object.entries(r).filter(([, v]) => String(v).toLowerCase().includes(low));
    if (hitF.length) out.industries.push({ key: r['行业编号'], title: `${r['行业编号']} ${r['细分行业']}`, sub: r['行业门类'], hitFields: hitF.map(([k]) => k) });
  }
  for (const r of DATA.jobs) {
    if (out.jobs.length >= cap) break;
    const hitF = Object.entries(r).filter(([, v]) => String(v).toLowerCase().includes(low));
    if (hitF.length) out.jobs.push({ key: `${r['行业编号']}|${r['常见职位']}`, title: `${r['行业编号']} · ${r['常见职位']}`, sub: (DATA._industryByCode.get(r['行业编号']) || {})['细分行业'] || '', hitFields: hitF.map(([k]) => k) });
  }
  for (const r of DATA.modes) {
    if (out.modes.length >= cap) break;
    const hitF = Object.entries(r).filter(([, v]) => String(v).toLowerCase().includes(low));
    if (hitF.length) out.modes.push({ key: `${r['行业编号']}|${r['细分模式']}`, title: `${r['行业编号']} · ${r['细分模式']}`, sub: '经营模式', hitFields: hitF.map(([k]) => k) });
  }
  for (const r of DATA.city_risks) {
    if (out.city_risks.length >= cap) break;
    const hay = `${r['行业编号']} ${r['城市']} ${r['风险层级']} ${r['依据与尽调要点']}`.toLowerCase();
    if (hay.includes(low)) out.city_risks.push({ key: `${r['行业编号']}|${r['城市']}`, title: `${r['行业编号']} · ${r['城市']}`, sub: r['风险层级'], hitFields: ['依据与尽调要点'] });
  }
  for (const r of DATA.cities) {
    if (out.cities.length >= cap) break;
    const hay = `${r['城市名称']} ${r['定位标签']}`.toLowerCase();
    if (hay.includes(low)) out.cities.push({ key: r['城市名称'], title: r['城市名称'], sub: r['定位标签'], hitFields: ['城市名称'] });
  }
  res.json({ ok: true, keyword: kw, results: out });
});

// ---------------------------------------------------------------- 路由：导入导出
app.get('/api/export/:name', requireAuth, (req, res) => {
  const name = req.params.name;
  if (name !== 'all' && !COLLECTIONS[name]) return res.status(404).json({ ok: false, error: '未知数据集' });
  const payload = name === 'all'
    ? { exported_at: nowIso(), source: SEED.meta.source, ...Object.fromEntries(Object.keys(COLLECTIONS).map((k) => [k, DATA[k]])) }
    : { exported_at: nowIso(), source: SEED.meta.source, [name]: DATA[name] };
  logAudit(req.user, '导出数据', name, '', '', null, null, req);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="xwk_${name}_${Date.now()}.json"`);
  res.send(JSON.stringify(payload, null, 1));
});

app.post('/api/import/:name', requireAuth, requireEdit, (req, res) => {
  const name = req.params.name;
  if (!COLLECTIONS[name]) return res.status(404).json({ ok: false, error: '未知数据集' });
  const rows = Array.isArray(req.body) ? req.body : (req.body && req.body[name]);
  if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ ok: false, error: '导入数据格式不正确（需为数组）' });

  const tpl = Object.keys((SEED[name] || [{}])[0] || {});
  const at = nowIso();
  let added = 0, updated = 0, skipped = 0, fieldsWritten = 0;
  const upsert = db.prepare(`INSERT INTO content_overrides (collection, rec_key, field, value, updated_by, updated_at)
      VALUES (?,?,?,?,?,?)
      ON CONFLICT(collection, rec_key, field) DO UPDATE SET value=excluded.value, updated_by=excluded.updated_by, updated_at=excluded.updated_at`);
  const seedByKey = new Map(SEED[name].map((r) => [COLLECTIONS[name].key(r), r]));

  for (const raw of rows) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { skipped++; continue; }
    const rec = {};
    for (const f of tpl) rec[f] = raw[f] == null ? '' : String(raw[f]);
    const key = COLLECTIONS[name].key(rec);
    if (!key || key.startsWith('|') || key.endsWith('|')) { skipped++; continue; }
    const old = seedByKey.get(key);
    if (!old) {
      SEED[name].push(rec); seedByKey.set(key, rec); added++;
      // 新增记录：整条写入覆盖层
      for (const [f, v] of Object.entries(rec)) { upsert.run(name, key, f, v, req.user.username, at); fieldsWritten++; }
    } else {
      // 已存在：仅写入与原始值不同的字段（幂等导入不污染覆盖层）
      let changed = 0;
      for (const [f, v] of Object.entries(rec)) {
        if (String(old[f] == null ? '' : old[f]) === v) continue;
        upsert.run(name, key, f, v, req.user.username, at); fieldsWritten++; changed++;
      }
      if (changed) updated++;
      else skipped++;
    }
  }
  logAudit(req.user, '导入数据', name, '', '', null, `新增${added} 更新${updated} 跳过${skipped} 写字段${fieldsWritten}`, req);
  refreshData();
  IND_SEARCH = buildIndustrySearchIndex();
  res.json({ ok: true, added, updated, skipped, fields_written: fieldsWritten });
});

// ---------------------------------------------------------------- 路由：系统管理
app.get('/api/admin/users', requireAuth, requireManage, (req, res) => {
  const rows = db.prepare(`SELECT id, username, display_name, role, can_view, can_edit, can_manage, enabled, must_change,
      is_builtin, remark, created_at, created_by, last_login_at, last_login_ip, last_login_ua FROM users ORDER BY id`).all();
  res.json({ ok: true, users: rows });
});

app.post('/api/admin/users', requireAuth, requireManage, (req, res) => {
  const b = req.body || {};
  const username = String(b.username || '').trim();
  const password = String(b.password || '');
  if (!/^[A-Za-z0-9_.@-]{3,32}$/.test(username)) return res.status(400).json({ ok: false, error: '用户名需为 3-32 位字母数字或 _ . @ -' });
  if (password.length < 8) return res.status(400).json({ ok: false, error: '密码至少 8 位' });
  if (db.prepare('SELECT id FROM users WHERE username=?').get(username)) return res.status(409).json({ ok: false, error: '用户名已存在' });

  const perms = normalizePerms(b);
  const { salt, hash } = hashPassword(password);
  const r = db.prepare(`INSERT INTO users
    (username, display_name, pass_salt, pass_hash, role, can_view, can_edit, can_manage, enabled, must_change, remark, created_at, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'')`).run(
    username, String(b.display_name || username), salt, hash, perms.role,
    perms.can_view, perms.can_edit, perms.can_manage, b.enabled === false ? 0 : 1,
    b.must_change === false ? 0 : 1, String(b.remark || ''), nowIso()
  );
  db.prepare("UPDATE users SET created_by=? WHERE id=?").run(req.user.username, r.lastInsertRowid);
  logAudit(req.user, '创建账号', 'users', username, '', null, JSON.stringify(perms), req);
  res.json({ ok: true, id: Number(r.lastInsertRowid) });
});

function normalizePerms(b) {
  const role = ['super_admin', 'editor', 'viewer'].includes(b.role) ? b.role : 'viewer';
  if (role === 'super_admin') return { role, can_view: 1, can_edit: 1, can_manage: 1 };
  if (role === 'editor') return {
    role,
    can_view: b.can_view === false ? 0 : 1,
    can_edit: b.can_edit === false ? 0 : 1,   // editor 默认拥有页面编辑权
    can_manage: 0,
  };
  return {                                     // viewer 默认只读
    role,
    can_view: b.can_view === false ? 0 : 1,
    can_edit: b.can_edit === true ? 1 : 0,
    can_manage: 0,
  };
}

app.put('/api/admin/users/:id', requireAuth, requireManage, (req, res) => {
  const id = Number(req.params.id);
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(id);
  if (!u) return res.status(404).json({ ok: false, error: '账号不存在' });
  const b = req.body || {};

  // 内置超级管理员保护：不可停用、不可降级、不可撤销管理权（可改密码/姓名/备注）
  if (u.is_builtin) {
    const demoting = (b.role && b.role !== 'super_admin') || b.enabled === false;
    if (demoting) {
      return res.status(400).json({ ok: false, error: '内置超级管理员不可停用或降级，只能修改密码/姓名/备注' });
    }
  }

  // 安全护栏：不允许把最后一个「启用的」超级管理员停用/降权
  // 注意：若目标本身已是停用状态，改动它不影响启用超管数量，应当放行
  if (u.role === 'super_admin' && u.enabled) {
    const supCount = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='super_admin' AND enabled=1").get().n;
    const demoting = (b.role && b.role !== 'super_admin') || b.enabled === false;
    if (supCount <= 1 && demoting) {
      return res.status(400).json({ ok: false, error: '系统必须保留至少一个启用的超级管理员' });
    }
  }

  const perms = b.role ? normalizePerms(b) : null;
  const fields = [], vals = [];
  if (perms) { fields.push('role=?', 'can_view=?', 'can_edit=?', 'can_manage=?'); vals.push(perms.role, perms.can_view, perms.can_edit, perms.can_manage); }
  if (b.display_name !== undefined) { fields.push('display_name=?'); vals.push(String(b.display_name)); }
  if (b.remark !== undefined) { fields.push('remark=?'); vals.push(String(b.remark)); }
  if (b.enabled !== undefined) { fields.push('enabled=?'); vals.push(b.enabled ? 1 : 0); }
  if (b.must_change !== undefined) { fields.push('must_change=?'); vals.push(b.must_change ? 1 : 0); }
  if (b.password) {
    if (String(b.password).length < 8) return res.status(400).json({ ok: false, error: '密码至少 8 位' });
    const { salt, hash } = hashPassword(b.password);
    fields.push('pass_salt=?', 'pass_hash=?', 'must_change=1');
    vals.push(salt, hash);
  }
  if (!fields.length) return res.status(400).json({ ok: false, error: '没有需要修改的字段' });

  vals.push(id);
  db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id=?`).run(...vals);
  if (b.enabled === false) db.prepare('UPDATE sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL').run(nowIso(), id);
  logAudit(req.user, '修改账号', 'users', u.username, '', JSON.stringify({ role: u.role, enabled: u.enabled }), JSON.stringify(b.password ? { ...b, password: '***' } : b), req);
  res.json({ ok: true });
});

app.delete('/api/admin/users/:id', requireAuth, requireManage, (req, res) => {
  const id = Number(req.params.id);
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(id);
  if (!u) return res.status(404).json({ ok: false, error: '账号不存在' });
  if (u.id === req.user.id) return res.status(400).json({ ok: false, error: '不能删除当前登录账号' });
  if (u.is_builtin) return res.status(400).json({ ok: false, error: '内置超级管理员不可删除（如需限制其权限，请另行创建管理员并妥善保管）' });
  // 仅当目标是「启用的」超管时才受限：删除已停用超管不影响系统可用性
  if (u.role === 'super_admin' && u.enabled) {
    const supCount = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='super_admin' AND enabled=1").get().n;
    if (supCount <= 1) return res.status(400).json({ ok: false, error: '系统必须保留至少一个启用的超级管理员' });
  }
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
  db.prepare('DELETE FROM users WHERE id=?').run(id);
  logAudit(req.user, '删除账号', 'users', u.username, '', null, null, req);
  res.json({ ok: true });
});

app.get('/api/admin/login-log', requireAuth, requireManage, (req, res) => {
  const limit = Math.min(1000, Math.max(1, Number(req.query.limit || 200)));
  const offset = Math.max(0, Number(req.query.offset || 0));
  const username = String(req.query.username || '').trim();
  const onlyOk = req.query.only_ok === '1';
  const where = [], args = [];
  if (username) { where.push('username = ?'); args.push(username); }
  if (onlyOk) where.push('ok = 1');
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) AS n FROM login_log ${w}`).get(...args).n;
  const rows = db.prepare(`SELECT * FROM login_log ${w} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset);
  res.json({ ok: true, total, rows });
});

app.get('/api/admin/audit-log', requireAuth, requireManage, (req, res) => {
  const limit = Math.min(1000, Math.max(1, Number(req.query.limit || 200)));
  const offset = Math.max(0, Number(req.query.offset || 0));
  const total = db.prepare('SELECT COUNT(*) AS n FROM audit_log').get().n;
  const rows = db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ? OFFSET ?').all(limit, offset);
  res.json({ ok: true, total, rows });
});

app.get('/api/admin/sessions', requireAuth, requireManage, (req, res) => {
  const rows = db.prepare(`SELECT s.token, s.username, s.created_at, s.expires_at, s.ip, s.user_agent, s.revoked_at, u.display_name
      FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.expires_at > ? ORDER BY s.created_at DESC LIMIT 200`).all(nowIso());
  res.json({
    ok: true,
    sessions: rows.map((r) => ({
      ...r,
      token_tail: '****' + String(r.token).slice(-6),
      active: !r.revoked_at,
      ...parseUA(r.user_agent),
    })),
  });
});

app.post('/api/admin/sessions/revoke', requireAuth, requireManage, (req, res) => {
  const t = String((req.body || {}).token || '');
  if (!t) return res.status(400).json({ ok: false, error: '缺少 token' });
  db.prepare('UPDATE sessions SET revoked_at=? WHERE token=?').run(nowIso(), t);
  logAudit(req.user, '强制下线', 'sessions', '****' + t.slice(-6), '', null, null, req);
  res.json({ ok: true });
});

app.get('/api/admin/settings', requireAuth, requireManage, (req, res) => {
  const rows = db.prepare("SELECT k, v FROM site_settings WHERE k NOT LIKE 'added_%' AND k NOT LIKE 'deleted_%'").all();
  res.json({ ok: true, settings: Object.fromEntries(rows.map((r) => [r.k, r.v])) });
});

app.post('/api/admin/settings', requireAuth, requireManage, (req, res) => {
  const b = req.body || {};
  for (const [k, v] of Object.entries(b)) {
    if (String(k).startsWith('added_') || String(k).startsWith('deleted_')) continue;
    db.prepare('INSERT INTO site_settings (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(String(k), String(v == null ? '' : v));
  }
  logAudit(req.user, '修改站点设置', 'site_settings', '', '', null, JSON.stringify(b).slice(0, 1000), req);
  res.json({ ok: true });
});

// 持久化状态
app.get('/api/admin/persist', requireAuth, requireManage, (req, res) => {
  res.json({ ok: true, persist: persist.status() });
});

// 手动立即保存快照（部署前 / 关机前用）
app.post('/api/admin/persist/save', requireAuth, requireManage, async (req, res) => {
  try {
    const r = await persist.save(true);
    logAudit(req.user, '手动保存快照', 'persist', '', '', null, JSON.stringify(r).slice(0, 300), req);
    res.json({ ok: true, result: r, persist: persist.status() });
  } catch (e) {
    res.status(500).json({ ok: false, error: '保存失败：' + e.message });
  }
});

// 数据健康自检（与 Excel 看板对账用）
app.get('/api/admin/selfcheck', requireAuth, requireManage, (req, res) => {
  const indCodes = DATA.industries.map((i) => i['行业编号']);
  const jobCodes = [...new Set(DATA.jobs.map((j) => j['行业编号']))];
  const modeCodes = [...new Set(DATA.modes.map((m) => m['行业编号']))];
  const cityNames = DATA.cities.map((c) => c['城市名称']);
  const riskKeys = new Set(DATA.city_risks.map((r) => r['行业编号'] + '|' + r['城市']));

  const missingJobs = indCodes.filter((c) => !jobCodes.includes(c));
  const missingModes = indCodes.filter((c) => !modeCodes.includes(c));
  const missingRisks = [];
  for (const c of indCodes) for (const city of cityNames) if (!riskKeys.has(c + '|' + city)) missingRisks.push(c + '|' + city);

  const emptyFields = [];
  for (const j of DATA.jobs) {
    for (const [k, v] of Object.entries(j)) if (!String(v || '').trim()) emptyFields.push(`jobs:${j['行业编号']}/${j['常见职位']}:${k}`);
  }
  for (const i of DATA.industries) {
    for (const [k, v] of Object.entries(i)) if (!String(v || '').trim() && k !== '职业标签串') emptyFields.push(`industries:${i['行业编号']}:${k}`);
  }
  const hasMianSign = JSON.stringify(DATA).includes('面签');
  const overrides = db.prepare('SELECT COUNT(*) AS n FROM content_overrides').get().n;

  res.json({
    ok: true,
    selfcheck: {
      行业总数: indCodes.length,
      职业覆盖行业数: jobCodes.length,
      缺职业的行业: missingJobs,
      模式覆盖行业数: modeCodes.length,
      缺经营模式的行业: missingModes,
      城市数: cityNames.length,
      城市风险记录数: DATA.city_risks.length,
      应有城市风险记录数: indCodes.length * cityNames.length,
      缺失城市风险: missingRisks.slice(0, 50),
      职业总条数: DATA.jobs.length,
      空字段: emptyFields.slice(0, 50),
      空字段总数: emptyFields.length,
      存在面签字样: hasMianSign,
      人工编辑覆盖字段数: overrides,
      通过: missingJobs.length === 0 && missingModes.length === 0 && missingRisks.length === 0
        && emptyFields.length === 0 && !hasMianSign,
    },
  });
});

// ---------------------------------------------------------------- 静态资源
app.use(express.static(path.join(ROOT, 'public'), { index: 'index.html', maxAge: '0' }));
app.get('/healthz', (req, res) => res.json({ ok: true, ts: nowIso(), industries: DATA.industries.length }));
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ ok: false, error: '接口不存在' });
  res.sendFile(path.join(ROOT, 'public', 'index.html'));
});
app.use((err, req, res, next) => {
  // body-parser 的 JSON 解析错误：返回 400 而非 500
  if (err && (err.type === 'entity.parse.failed' || err instanceof SyntaxError && 'body' in err)) {
    return res.status(400).json({ ok: false, error: '请求体不是合法 JSON，请检查导入文件格式' });
  }
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ ok: false, error: '请求体过大（上限 32MB）' });
  }
  console.error('[错误]', err);
  const status = Number(err && err.status) || 500;
  res.status(status).json({ ok: false, error: '服务器内部错误: ' + (err && err.message ? err.message : String(err)) });
});

/** 变更后的节流快照：1.5 秒内的多次改动合并为一次 */
let saveTimer = null;
function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    persist.save(false).catch((e) => console.error('[快照失败]', e.message));
  }, 1500);
}

/** 恢复完成后必须重建内存索引，否则覆盖层不生效 */
function reloadAfterRestore() {
  refreshData();
  IND_SEARCH = buildIndustrySearchIndex();
}

async function boot() {
  // 先恢复持久化状态（云上重启会从 Git 分支拉回账号与编辑内容）
  let restored = { source: 'none' };
  try {
    restored = await persist.init(db, { persistDir: path.join(DATA_DIR, 'persist') });
    reloadAfterRestore();
  } catch (e) {
    console.error('[持久化初始化失败，将以本地状态继续]', e.message);
  }

  const server = app.listen(PORT, HOST, () => {
    const nets = os.networkInterfaces();
    const ips = [];
    for (const k of Object.keys(nets)) for (const n of nets[k] || []) if (n.family === 'IPv4' && !n.internal) ips.push(n.address);
    const nUsers = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
    const nOv = db.prepare('SELECT COUNT(*) AS n FROM content_overrides').get().n;
    console.log('='.repeat(60));
    console.log('小微行业知识库看板 V3 · Web 版');
    console.log('='.repeat(60));
    console.log(`数据：${DATA.industries.length} 行业 / ${DATA.jobs.length} 职业 / ${DATA.cities.length} 城市 / ${DATA.city_risks.length} 城市风险`);
    console.log(`账号：${nUsers} 个　人工编辑字段：${nOv} 处　状态来源：${restored.source}`);
    console.log(`本机访问：  http://localhost:${PORT}`);
    for (const ip of ips) console.log(`局域网访问：http://${ip}:${PORT}`);
    const ps = persist.status();
    console.log(`持久化：    ${ps.mode}${ps.repo && ps.repo !== '(未配置)' ? ' → ' + ps.repo + '@' + ps.branch : ''}`);
    if (nUsers <= 1) console.log('初始超级管理员：gaoyuxi / wt1201263（首次登录后请立即修改密码）');
    console.log('='.repeat(60));
  });

  process.on('SIGINT', () => {
    console.log('\n正在保存状态并关闭…');
    persist.save(true).catch(() => {}).finally(() => server.close(() => process.exit(0)));
    setTimeout(() => process.exit(0), 4000);
  });
  process.on('SIGTERM', () => {
    persist.save(true).catch(() => {}).finally(() => server.close(() => process.exit(0)));
    setTimeout(() => process.exit(0), 4000);
  });
  return server;
}

boot().catch((e) => { console.error('[启动失败]', e); process.exit(1); });
