/**
 * 持久化层 —— 解决免费云平台「文件系统临时、重启即清空」的问题
 *
 * 思路：把运行时状态（账号 / 内容编辑 / 站点设置 / 日志）序列化为 JSON 快照，
 *      推送到 GitHub 仓库的一个独立分支（默认 xwk-persist），重启时自动拉回。
 *      独立分支不会触发 Render/Railway 的自动重新部署，避免部署循环。
 *
 * 未配置 GITHUB_TOKEN 时：退化为本地文件持久化（本机部署够用）。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const FILES = ['users.json', 'overrides.json', 'settings.json', 'logs.json'];

let db = null;
let cfg = null;
let timer = null;
let lastHash = '';
let lastPushAt = null;
let lastPushOk = null;
let lastPushMsg = '';
let pushCount = 0;

// ---------------------------------------------------------------- 工具
function sha1(s) {
  return require('crypto').createHash('sha1').update(s).digest('hex');
}

function log(...a) {
  console.log('[持久化]', ...a);
}

async function gh(method, urlPath, body) {
  if (!cfg.token) throw new Error('未配置 GITHUB_TOKEN');
  const res = await fetch(`https://api.github.com${urlPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'xwk-knowledge-base',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 300) }; }
  if (!res.ok) {
    const msg = (data && data.message) || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// ---------------------------------------------------------------- 快照生成
function buildSnapshot() {
  const users = db.prepare(`SELECT username, display_name, pass_salt, pass_hash, role,
      can_view, can_edit, can_manage, enabled, must_change, is_builtin, remark,
      created_at, created_by, last_login_at, last_login_ip, last_login_ua
      FROM users ORDER BY id`).all();

  const overrides = db.prepare(`SELECT collection, rec_key, field, value, updated_by, updated_at
      FROM content_overrides ORDER BY id`).all();

  const settings = db.prepare(`SELECT k, v FROM site_settings ORDER BY k`).all();

  const logs = db.prepare(`SELECT username, user_id, ok, reason, ip, ip_public, device, browser,
      os_name, user_agent, at FROM login_log ORDER BY id DESC LIMIT ?`).all(cfg.logCap);

  const audit = db.prepare(`SELECT username, action, collection, target, field, old_value, new_value, ip, at
      FROM audit_log ORDER BY id DESC LIMIT ?`).all(cfg.logCap);

  return {
    'users.json': JSON.stringify({ _kind: 'users', saved_at: new Date().toISOString(), rows: users }, null, 1),
    'overrides.json': JSON.stringify({ _kind: 'overrides', saved_at: new Date().toISOString(), rows: overrides }, null, 1),
    'settings.json': JSON.stringify({ _kind: 'settings', saved_at: new Date().toISOString(), rows: settings }, null, 1),
    'logs.json': JSON.stringify({ _kind: 'logs', saved_at: new Date().toISOString(), login: logs, audit }, null, 1),
  };
}

// ---------------------------------------------------------------- 本地读写
function readLocal() {
  const out = {};
  for (const f of FILES) {
    const p = path.join(cfg.dir, f);
    if (fs.existsSync(p)) {
      try { out[f] = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { log(`本地 ${f} 解析失败：${e.message}`); }
    }
  }
  return out;
}

function writeLocal(snap) {
  fs.mkdirSync(cfg.dir, { recursive: true });
  for (const [f, txt] of Object.entries(snap)) {
    fs.writeFileSync(path.join(cfg.dir, f), txt, 'utf8');
  }
}

// ---------------------------------------------------------------- 远程读写
async function fetchRemote() {
  const out = {};
  for (const f of FILES) {
    try {
      const d = await gh('GET', `/repos/${cfg.repo}/contents/${cfg.remoteDir}/${f}?ref=${cfg.branch}`);
      if (d && d.content) out[f] = JSON.parse(Buffer.from(d.content, 'base64').toString('utf8'));
    } catch (e) {
      if (e.status !== 404) log(`拉取 ${f} 失败：${e.message}`);
    }
  }
  return out;
}

async function pushRemote(snap) {
  for (const [f, txt] of Object.entries(snap)) {
    const p = `${cfg.remoteDir}/${f}`;
    let sha = null;
    try {
      const cur = await gh('GET', `/repos/${cfg.repo}/contents/${p}?ref=${cfg.branch}`);
      sha = cur.sha;
    } catch (e) {
      if (e.status !== 404) throw e;
    }
    await gh('PUT', `/repos/${cfg.repo}/contents/${p}`, {
      message: `chore(persist): 快照 ${f} [skip ci]`,
      content: Buffer.from(txt, 'utf8').toString('base64'),
      branch: cfg.branch,
      ...(sha ? { sha } : {}),
    });
  }
}

async function ensureBranch() {
  try {
    await gh('GET', `/repos/${cfg.repo}/branches/${cfg.branch}`);
    return;
  } catch (e) {
    if (e.status !== 404) throw e;
  }
  // 基于默认分支创建持久化分支
  let defBranch = 'main';
  try {
    const repo = await gh('GET', `/repos/${cfg.repo}`);
    defBranch = (repo && repo.default_branch) || 'main';
  } catch { /* 用默认值 */ }
  let ref;
  try {
    ref = await gh('GET', `/repos/${cfg.repo}/git/ref/heads/${defBranch}`);
  } catch (e) {
    throw new Error(`无法读取默认分支 ${defBranch}：${e.message}`);
  }
  await gh('POST', `/repos/${cfg.repo}/git/refs`, {
    ref: `refs/heads/${cfg.branch}`,
    sha: ref.object.sha,
  });
  log(`已创建持久化分支 ${cfg.branch}`);
}

/** 检查仓库可见性：公开仓库禁止推送账号数据 */
async function checkRepoSafety() {
  try {
    const repo = await gh('GET', `/repos/${cfg.repo}`);
    const isPrivate = repo && repo.private === true;
    if (!isPrivate && cfg.persistAccounts) {
      log(`⚠️ 仓库 ${cfg.repo} 是【公开】的，为防泄露账号与密码哈希，本次将【不推送】users.json / logs.json`);
      log('   如需完整持久化，请把仓库设为 Private，或设置 PERSIST_ACCOUNTS=false 后自行管理账号。');
      return { private: false, safeUsers: false };
    }
    return { private: isPrivate, safeUsers: true };
  } catch (e) {
    log(`无法确认仓库可见性（${e.message}），保守起见不推送账号数据`);
    return { private: null, safeUsers: false };
  }
}

// ---------------------------------------------------------------- 恢复
function restore(snapshotObj) {
  if (!snapshotObj || !Object.keys(snapshotObj).length) return { restored: 0 };
  let n = 0;

  const users = snapshotObj['users.json'];
  if (users && Array.isArray(users.rows)) {
    const ins = db.prepare(`INSERT INTO users
      (username, display_name, pass_salt, pass_hash, role, can_view, can_edit, can_manage,
       enabled, must_change, is_builtin, remark, created_at, created_by, last_login_at, last_login_ip, last_login_ua)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(username) DO UPDATE SET
        display_name=excluded.display_name, pass_salt=excluded.pass_salt, pass_hash=excluded.pass_hash,
        role=excluded.role, can_view=excluded.can_view, can_edit=excluded.can_edit, can_manage=excluded.can_manage,
        enabled=excluded.enabled, must_change=excluded.must_change, remark=excluded.remark`);
    for (const u of users.rows) {
      ins.run(u.username, u.display_name || '', u.pass_salt, u.pass_hash, u.role || 'viewer',
        u.can_view ? 1 : 0, u.can_edit ? 1 : 0, u.can_manage ? 1 : 0,
        u.enabled ? 1 : 0, u.must_change ? 1 : 0, u.is_builtin ? 1 : 0, u.remark || '',
        u.created_at || new Date().toISOString(), u.created_by || 'persist',
        u.last_login_at || null, u.last_login_ip || null, u.last_login_ua || null);
      n++;
    }
  }

  const ov = snapshotObj['overrides.json'];
  if (ov && Array.isArray(ov.rows)) {
    const ins = db.prepare(`INSERT INTO content_overrides (collection, rec_key, field, value, updated_by, updated_at)
      VALUES (?,?,?,?,?,?)
      ON CONFLICT(collection, rec_key, field) DO UPDATE SET
        value=excluded.value, updated_by=excluded.updated_by, updated_at=excluded.updated_at`);
    for (const r of ov.rows) {
      ins.run(r.collection, r.rec_key, r.field, r.value == null ? '' : r.value, r.updated_by || 'persist', r.updated_at || new Date().toISOString());
      n++;
    }
  }

  const st = snapshotObj['settings.json'];
  if (st && Array.isArray(st.rows)) {
    const ins = db.prepare('INSERT INTO site_settings (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v');
    for (const r of st.rows) { ins.run(r.k, r.v == null ? '' : r.v); n++; }
  }

  const lg = snapshotObj['logs.json'];
  if (lg) {
    if (Array.isArray(lg.login)) {
      const ins = db.prepare(`INSERT INTO login_log
        (username, user_id, ok, reason, ip, ip_public, device, browser, os_name, user_agent, at)
        SELECT ?,?,?,?,?,?,?,?,?,?,?
        WHERE NOT EXISTS (SELECT 1 FROM login_log WHERE username=? AND at=? AND ip=? AND ok=?)`);
      for (const r of lg.login) {
        const res = ins.run(r.username || '', r.user_id || null, r.ok ? 1 : 0, r.reason || '',
          r.ip || '', r.ip_public || '', r.device || '', r.browser || '', r.os_name || '',
          r.user_agent || '', r.at || '',
          r.username || '', r.at || '', r.ip || '', r.ok ? 1 : 0);
        if (res.changes) n++;
      }
    }
    if (Array.isArray(lg.audit)) {
      const ins = db.prepare(`INSERT INTO audit_log
        (username, action, collection, target, field, old_value, new_value, ip, at)
        SELECT ?,?,?,?,?,?,?,?,?
        WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE username=? AND action=? AND at=? AND target=?)`);
      for (const r of lg.audit) {
        const res = ins.run(r.username || '', r.action || '', r.collection || '', r.target || '',
          r.field || '', r.old_value == null ? null : r.old_value, r.new_value == null ? null : r.new_value,
          r.ip || '', r.at || '',
          r.username || '', r.action || '', r.at || '', r.target || '');
        if (res.changes) n++;
      }
    }
  }
  return { restored: n };
}

// ---------------------------------------------------------------- 保存
async function save(force) {
  const snap = buildSnapshot();
  const hash = sha1(Object.values(snap).join('|'));
  if (!force && hash === lastHash) return { skipped: true };

  writeLocal(snap);
  lastHash = hash;

  if (!cfg.token || !cfg.repo) {
    lastPushAt = new Date().toISOString();
    lastPushOk = true;
    lastPushMsg = '仅本地持久化（未配置 GitHub）';
    return { local: true };
  }

  // 公开仓库保护：剔除账号与日志
  let payload = snap;
  if (cfg.safeUsers === false) {
    payload = { 'overrides.json': snap['overrides.json'], 'settings.json': snap['settings.json'] };
  }
  try {
    await pushRemote(payload);
    pushCount++;
    lastPushAt = new Date().toISOString();
    lastPushOk = true;
    lastPushMsg = `已推送到 ${cfg.repo}@${cfg.branch}（${Object.keys(payload).join(', ')}）`;
    log(lastPushMsg);
    return { pushed: true };
  } catch (e) {
    lastPushAt = new Date().toISOString();
    lastPushOk = false;
    lastPushMsg = e.message;
    log(`推送失败：${e.message}`);
    return { error: e.message };
  }
}

// ---------------------------------------------------------------- 初始化
async function init(database, opts) {
  db = database;
  cfg = {
    dir: opts.persistDir,
    token: process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '',
    repo: process.env.GITHUB_REPO || '',                       // 形如 owner/name
    branch: process.env.PERSIST_BRANCH || 'xwk-persist',
    remoteDir: process.env.PERSIST_DIR_REMOTE || 'persist',
    intervalSec: Number(process.env.PERSIST_INTERVAL_SEC || 60),
    logCap: Number(process.env.PERSIST_LOG_CAP || 3000),
    persistAccounts: String(process.env.PERSIST_ACCOUNTS || 'true') !== 'false',
    safeUsers: true,
  };
  fs.mkdirSync(cfg.dir, { recursive: true });

  // 1) 恢复：优先远程（云上重启后本地是空的），其次本地
  let source = 'none';
  if (cfg.token && cfg.repo) {
    try {
      await ensureBranch();
      cfg.safeUsers = (await checkRepoSafety()).safeUsers;
      const remote = await fetchRemote();
      if (Object.keys(remote).length) {
        const r = restore(remote);
        source = `git:${cfg.branch}（恢复 ${r.restored} 条）`;
        log(`已从远程分支恢复状态：${source}`);
      }
    } catch (e) {
      log(`远程恢复失败（${e.message}），尝试本地快照`);
    }
  }
  if (source === 'none') {
    const local = readLocal();
    if (Object.keys(local).length) {
      const r = restore(local);
      source = `本地快照（恢复 ${r.restored} 条）`;
      log(source);
    }
  }
  if (source === 'none') log('无可恢复的快照，使用当前数据库状态（首次部署）');

  // 2) 定时快照
  if (timer) clearInterval(timer);
  timer = setInterval(() => { save(false).catch((e) => log('定时快照异常：' + e.message)); }, cfg.intervalSec * 1000);
  if (timer.unref) timer.unref();

  // 3) 退出前保存
  const flush = () => {
    try {
      const snap = buildSnapshot();
      writeLocal(snap);
    } catch { /* 忽略 */ }
  };
  process.on('SIGTERM', flush);
  process.on('SIGINT', flush);
  process.on('exit', flush);

  // 4) 启动后先做一次基线保存
  setTimeout(() => { save(true).catch(() => {}); }, 2500);

  return { source };
}

function status() {
  return {
    enabled: true,
    mode: (cfg && cfg.token && cfg.repo) ? 'GitHub 远程 + 本地' : '仅本地',
    repo: cfg ? cfg.repo || '(未配置)' : '(未初始化)',
    branch: cfg ? cfg.branch : '',
    interval_sec: cfg ? cfg.intervalSec : 0,
    log_cap: cfg ? cfg.logCap : 0,
    push_count: pushCount,
    last_push_at: lastPushAt,
    last_push_ok: lastPushOk,
    last_push_msg: lastPushMsg,
    account_data_persisted: cfg ? cfg.safeUsers : false,
    files: FILES,
  };
}

module.exports = { init, save, status };
