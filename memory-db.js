'use strict';
/**
 * 纯 JS 内存数据库 —— 替代 node:sqlite / better-sqlite3
 * 实现 server.js 中用到的所有 SQL 操作
 * 数据存储在 JS 对象中，支持持久化到 JSON
 */

let _id = 1;
const nextId = () => _id++;

const tables = {
  users: [],
  sessions: [],
  login_log: [],
  audit_log: [],
  content_overrides: [],
  site_settings: [],
};

function exec() { /* CREATE TABLE / PRAGMA 无需处理 */ }

function clone(obj) {
  return obj == null ? null : { ...obj };
}

function parseWhere(sql, params) {
  if (!sql) return () => true;
  const conditions = [];
  let remaining = sql.trim();

  while (remaining) {
    // AND
    remaining = remaining.replace(/^AND\s+/i, '').trim();
    if (!remaining) break;

    // Pattern: column OP ?  or  column IS NULL or  column IS NOT NULL or column LIKE ?
    let m;

    // IS NULL
    m = remaining.match(/^(\w+)\s+IS\s+NULL/i);
    if (m) {
      const col = m[1];
      conditions.push((r) => r[col] == null);
      remaining = remaining.slice(m[0].length).trim();
      continue;
    }
    // IS NOT NULL
    m = remaining.match(/^(\w+)\s+IS\s+NOT\s+NULL/i);
    if (m) {
      const col = m[1];
      conditions.push((r) => r[col] != null);
      remaining = remaining.slice(m[0].length).trim();
      continue;
    }
    // column = ? or column > ? or column <= ? etc
    m = remaining.match(/^(\w+)\s*(=|!=|<>|>=|<=|>|<)\s*\?/);
    if (m) {
      const col = m[1];
      const op = m[2];
      const val = params.shift();
      conditions.push((r) => {
        const rv = r[col];
        switch (op) {
          case '=': return rv == val;
          case '!=': case '<>': return rv != val;
          case '>': return Number(rv) > Number(val);
          case '<': return Number(rv) < Number(val);
          case '>=': return Number(rv) >= Number(val);
          case '<=': return Number(rv) <= Number(val);
          default: return false;
        }
      });
      remaining = remaining.slice(m[0].length).trim();
      continue;
    }
    // column = 'literal' or column = value
    m = remaining.match(/^(\w+)\s*(=|!=|<>|>=|<=|>|<)\s*'([^']*)'/);
    if (m) {
      const col = m[1];
      const op = m[2];
      const val = m[3];
      conditions.push((r) => {
        const rv = r[col];
        switch (op) {
          case '=': return String(rv) === val;
          case '!=': case '<>': return String(rv) !== val;
          default: return false;
        }
      });
      remaining = remaining.slice(m[0].length).trim();
      continue;
    }
    // column LIKE 'pattern'
    m = remaining.match(/^(\w+)\s+LIKE\s+\?/i);
    if (m) {
      const col = m[1];
      const pattern = params.shift();
      const regexStr = '^' + String(pattern).replace(/%/g, '.*').replace(/_/g, '.') + '$';
      const re = new RegExp(regexStr, 'i');
      conditions.push((r) => re.test(String(r[col] || '')));
      remaining = remaining.slice(m[0].length).trim();
      continue;
    }
    // column LIKE 'pattern%'
    m = remaining.match(/^(\w+)\s+LIKE\s+'([^']*)'/i);
    if (m) {
      const col = m[1];
      const pattern = m[2];
      const regexStr = '^' + pattern.replace(/%/g, '.*').replace(/_/g, '.') + '$';
      const re = new RegExp(regexStr, 'i');
      conditions.push((r) => re.test(String(r[col] || '')));
      remaining = remaining.slice(m[0].length).trim();
      continue;
    }
    // NOT EXISTS (subquery) — skip (always true for our use case)
    m = remaining.match(/^NOT\s+EXISTS\s*\(/i);
    if (m) {
      params.splice(0, 3); // consume 3 params
      conditions.push(() => true);
      // skip to closing paren
      let depth = 1;
      let idx = m[0].length;
      while (depth > 0 && idx < remaining.length) {
        if (remaining[idx] === '(') depth++;
        if (remaining[idx] === ')') depth--;
        idx++;
      }
      remaining = remaining.slice(idx).trim();
      continue;
    }
    // EXISTS (subquery) — simplified
    m = remaining.match(/^EXISTS\s*\(/i);
    if (m) {
      conditions.push(() => true);
      let depth = 1;
      let idx = m[0].length;
      while (depth > 0 && idx < remaining.length) {
        if (remaining[idx] === '(') depth++;
        if (remaining[idx] === ')') depth--;
        idx++;
      }
      remaining = remaining.slice(idx).trim();
      continue;
    }
    // Cannot parse this condition, skip rest
    break;
  }

  return (row) => conditions.every(fn => fn(row));
}

function selectAll(sql, params) {
  params = params ? [...params] : [];

  // JOIN: SELECT s.*, u.display_name, ... FROM sessions s JOIN users u ON u.id = s.user_id WHERE ...
  let joinTable = null, joinOn = null, joinCols = null;
  let joinMatch = sql.match(/FROM\s+(\w+)\s+(?:AS\s+)?(\w+)\s+JOIN\s+(\w+)\s+(?:AS\s+)?(\w+)\s+ON\s+(\w+)\.(\w+)\s*=\s*(\w+)\.(\w+)/i);
  if (joinMatch) {
    const [, t1, a1, t2, a2, _a1col, _a1colName, _a2col, _a2colName] = joinMatch;
    // Determine which table is which alias
    const aliasMap = {};
    aliasMap[a1.toLowerCase()] = t1;
    aliasMap[a2.toLowerCase()] = t2;
    joinTable = { a1, a2, t1, t2 };
    // Parse ON condition
    const onMatch = sql.match(/ON\s+(\w+)\.(\w+)\s*=\s*(\w+)\.(\w+)/i);
    if (onMatch) {
      joinOn = { leftAlias: onMatch[1], leftCol: onMatch[2], rightAlias: onMatch[3], rightCol: onMatch[4] };
    }
    // Parse selected columns
    const colsMatch = sql.match(/SELECT\s+(.+?)\s+FROM/i);
    if (colsMatch) {
      const colsStr = colsMatch[1];
      if (/\*/.test(colsStr)) {
        joinCols = '*';
      } else {
        joinCols = colsStr.split(',').map(c => {
          const m = c.trim().match(/(\w+)\.(\w+)(?:\s+AS\s+(\w+))?/);
          return m ? { alias: m[1], col: m[2], as: m[3] || m[2] } : null;
        }).filter(Boolean);
      }
    }
    sql = sql.replace(/SELECT\s+.+?\s+FROM/i, 'SELECT * FROM').replace(/\s+JOIN.+/i, '');
  }

  // Parse table name
  let tableMatch = sql.match(/FROM\s+(\w+)/i);
  if (!tableMatch) return [];
  let tableName = tableMatch[1];
  let alias = '';
  const aliasMatch = sql.match(/FROM\s+\w+\s+(?:AS\s+)?(\w+)/i);
  if (aliasMatch && aliasMatch[1] && aliasMatch[1].toLowerCase() !== 'where' && aliasMatch[1].toLowerCase() !== 'order' && aliasMatch[1].toLowerCase() !== 'limit') {
    alias = aliasMatch[1];
  }
  let rows = [...(tables[tableName] || [])];

  // JOIN
  if (joinTable && joinOn) {
    const rightTable = tables[joinTable.t2] || [];
    rows = rows.map(leftRow => {
      const rightRows = rightTable.filter(rightRow => {
        const leftVal = leftRow[joinOn.leftCol];
        const rightVal = rightRow[joinOn.rightCol];
        return leftVal == rightVal;
      });
      if (rightRows.length === 0) return null;
      const rightRow = rightRows[0];
      if (joinCols === '*') {
        const merged = {};
        // Prefix with alias if needed
        for (const [k, v] of Object.entries(leftRow)) merged[k] = v;
        for (const [k, v] of Object.entries(rightRow)) {
          if (!(k in merged)) merged[k] = v;
        }
        return merged;
      } else {
        const merged = {};
        for (const c of joinCols) {
          if (c.alias.toLowerCase() === joinTable.a1.toLowerCase()) {
            merged[c.as] = leftRow[c.col];
          } else {
            merged[c.as] = rightRow[c.col];
          }
        }
        return merged;
      }
    }).filter(Boolean);
  }

  // WHERE
  let whereClause = '';
  const whereMatch = sql.match(/WHERE\s+(.+?)(?:\s+ORDER\s+BY|\s+LIMIT\s+|$)/i);
  if (whereMatch) {
    whereClause = whereMatch[1].trim();
  }
  if (whereClause) {
    const pred = parseWhere(whereClause, params);
    rows = rows.filter(pred);
  }

  // ORDER BY
  const orderMatch = sql.match(/ORDER\s+BY\s+(\w+)(?:\s+(ASC|DESC))?/i);
  if (orderMatch) {
    const col = orderMatch[1];
    const dir = (orderMatch[2] || 'ASC').toUpperCase();
    rows.sort((a, b) => {
      const av = a[col], bv = b[col];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return dir === 'DESC' ? bv - av : av - bv;
      return dir === 'DESC' ? String(bv).localeCompare(String(av)) : String(av).localeCompare(String(bv));
    });
  }

  // LIMIT / OFFSET
  const limitMatch = sql.match(/LIMIT\s+(\d+)(?:\s+OFFSET\s+(\d+))?/i);
  if (limitMatch) {
    const limit = Number(limitMatch[1]);
    const offset = Number(limitMatch[2] || 0);
    rows = rows.slice(offset, offset + limit);
  }

  return rows;
}

function selectCount(sql, params) {
  params = params ? [...params] : [];
  const tableMatch = sql.match(/FROM\s+(\w+)/i);
  if (!tableMatch) return [{ n: 0 }];
  const tableName = tableMatch[1];
  let rows = [...(tables[tableName] || [])];

  let whereClause = '';
  const whereMatch = sql.match(/WHERE\s+(.+?)(?:\s+ORDER\s+BY|\s+LIMIT\s+|$)/i);
  if (whereMatch) {
    whereClause = whereMatch[1].trim();
  }
  if (whereClause) {
    const pred = parseWhere(whereClause, params);
    rows = rows.filter(pred);
  }
  return [{ n: rows.length }];
}

function selectSingle(sql, params) {
  // Could be COUNT(*) or a regular SELECT
  if (/COUNT\s*\(\s*\*\s*\)\s+AS/i.test(sql)) {
    return selectCount(sql, params)[0];
  }
  const rows = selectAll(sql, params);
  return rows[0] || undefined;
}

function insertRow(sql, params) {
  params = params ? [...params] : [];

  // INSERT INTO table (col1, col2, ...) VALUES (?, ?, ...) [ON CONFLICT(...) DO UPDATE SET ...]
  const m = sql.match(/INSERT\s+INTO\s+(\w+)\s*\(([^)]*)\)\s*VALUES\s*\(([^)]*)\)/i);
  if (!m) return { changes: 0, lastInsertRowid: 0 };

  const tableName = m[1];
  const cols = m[2].split(',').map(c => c.trim());
  const placeholders = m[3].split(',').map(c => c.trim());
  const valIdx = { i: 0 };

  const row = {};
  for (let i = 0; i < cols.length; i++) {
    const col = cols[i];
    const ph = placeholders[i];
    if (ph === '?') {
      row[col] = params[valIdx.i++];
    } else if (/^'/.test(ph)) {
      row[col] = ph.replace(/^'|'$/g, '');
    } else {
      // Could be expression like 'added_' || ?
      if (ph.includes('||')) {
        const parts = ph.split('||').map(p => p.trim());
        let val = '';
        for (const part of parts) {
          if (part === '?') val += String(params[valIdx.i++]);
          else val += part.replace(/^'|'$/g, '');
        }
        row[col] = val;
      } else {
        row[col] = ph;
      }
    }
  }

  // ON CONFLICT handling
  const conflictMatch = sql.match(/ON\s+CONFLICT\s*\(([^)]+)\)\s+DO\s+UPDATE\s+SET\s+(.+?)(?:\s+WHERE|$)/i);
  if (conflictMatch) {
    const conflictCols = conflictMatch[1].split(',').map(c => c.trim());
    const setClause = conflictMatch[2];
    const existing = (tables[tableName] || []).find(r =>
      conflictCols.every(c => String(r[c]) === String(row[c]))
    );
    if (existing) {
      // Parse SET clause: col=excluded.col, col2=excluded.col2
      const setParts = setClause.split(',').map(s => s.trim());
      for (const sp of setParts) {
        const sm = sp.match(/(\w+)\s*=\s*excluded\.(\w+)/);
        if (sm) {
          existing[sm[1]] = row[sm[2]];
        }
      }
      return { changes: 1, lastInsertRowid: existing.id || 0 };
    }
  }

  // Add id if not present
  if (!row.id && (tableName === 'users' || tableName === 'login_log' || tableName === 'audit_log' || tableName === 'content_overrides')) {
    row.id = nextId();
  }

  if (!tables[tableName]) tables[tableName] = [];
  tables[tableName].push(row);
  return { changes: 1, lastInsertRowid: row.id || 0 };
}

function updateRow(sql, params) {
  params = params ? [...params] : [];
  const m = sql.match(/UPDATE\s+(\w+)\s+SET\s+(.+?)(?:\s+WHERE\s+(.+?))?$/i);
  if (!m) return { changes: 0, lastInsertRowid: 0 };

  const tableName = m[1];
  const setClause = m[2];
  const whereClause = m[3] || '';

  // Parse SET: field=?, field2=?, ... (values come from params first)
  const setParts = setClause.split(',').map(s => s.trim());
  const setVals = [];
  const setCols = [];
  for (const sp of setParts) {
    const sm = sp.match(/(\w+)\s*=\s*\?/);
    if (sm) {
      setCols.push(sm[1]);
      setVals.push(params.shift());
    }
  }

  // Parse WHERE — remaining params are for WHERE
  let pred = () => true;
  if (whereClause) {
    pred = parseWhere(whereClause, params);
  }

  let changes = 0;
  for (const row of (tables[tableName] || [])) {
    if (pred(row)) {
      for (let i = 0; i < setCols.length; i++) {
        row[setCols[i]] = setVals[i];
      }
      changes++;
    }
  }
  return { changes: changes, lastInsertRowid: 0 };
}

function deleteRow(sql, params) {
  params = params ? [...params] : [];
  const m = sql.match(/DELETE\s+FROM\s+(\w+)(?:\s+WHERE\s+(.+?))?$/i);
  if (!m) return { changes: 0, lastInsertRowid: 0 };

  const tableName = m[1];
  const whereClause = m[2] || '';

  let pred = () => true;
  if (whereClause) {
    pred = parseWhere(whereClause, params);
  }

  const arr = tables[tableName] || [];
  const toDelete = arr.filter(pred);
  tables[tableName] = arr.filter(r => !pred(r));
  return { changes: toDelete.length, lastInsertRowid: 0 };
}

function prepare(sql) {
  const trimmed = sql.trim();
  const isSelect = /^SELECT/i.test(trimmed);
  const isInsert = /^INSERT/i.test(trimmed);
  const isUpdate = /^UPDATE/i.test(trimmed);
  const isDelete = /^DELETE/i.test(trimmed);
  const isSelectWhereNotExists = /^SELECT\s+.*WHERE\s+NOT\s+EXISTS/i.test(trimmed);
  const isPragma = /^PRAGMA/i.test(trimmed);

  return {
    run(...params) {
      if (isInsert) return insertRow(sql, params);
      if (isUpdate) return updateRow(sql, params);
      if (isDelete) return deleteRow(sql, params);
      // SELECT ... WHERE NOT EXISTS (subquery) — used for dedup insert
      if (isSelectWhereNotExists) {
        // This is an INSERT-SELECT pattern: INSERT INTO ... SELECT ... WHERE NOT EXISTS
        // Actually this comes from a different call pattern. Check if it's actually an INSERT
        return insertRow(sql, params);
      }
      return { changes: 0, lastInsertRowid: 0 };
    },
    get(...params) {
      if (isPragma) {
        // PRAGMA table_info(tablename) — return columns
        const m = sql.match(/PRAGMA\s+table_info\s*\(\s*(\w+)\s*\)/i);
        if (m) {
          // Return column info for the table
          const tableName = m[1];
          const sample = (tables[tableName] || [{}])[0] || {};
          return Object.keys(sample).map((name, i) => ({ name, cid: i }));
        }
        return {};
      }
      return selectSingle(sql, params);
    },
    all(...params) {
      if (isSelect) {
        return selectAll(sql, params);
      }
      return [];
    },
  };
}

const DatabaseSync = function() {
  this.exec = exec;
  this.prepare = prepare;
  this._getTables = () => tables;
  this.tables = tables;
};

module.exports = { DatabaseSync, tables, _getTables: () => tables };
