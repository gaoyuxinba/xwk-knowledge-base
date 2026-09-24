'use strict';
/**
 * sql.js → DatabaseSync API 兼容层
 * 纯 JS + WASM 实现，无原生依赖，兼容 Vercel/FC 等 Serverless 环境
 */

const path = require('path');
const crypto = require('crypto');

let SQL = null;
let initPromise = null;

async function init() {
  if (SQL) return SQL;
  if (initPromise) return initPromise;
  
  const initSqlJs = require('sql.js');
  initPromise = initSqlJs().then((sql) => { SQL = sql; return sql; });
  return initPromise;
}

class DatabaseSync {
  constructor(filePath, options = {}) {
    this.filePath = filePath;
    this.options = options;
    this.db = null;
    this._ready = false;
    this._initPromise = null;
  }
  
  async _init() {
    if (this._ready) return;
    if (this._initPromise) return this._initPromise;
    
    this._initPromise = (async () => {
      await init();
      const fs = require('fs');
      if (fs.existsSync(this.filePath)) {
        const buf = fs.readFileSync(this.filePath);
        this.db = new SQL.Database(buf);
      } else {
        this.db = new SQL.Database();
        this._save();
      }
      this._ready = true;
    })();
    
    return this._initPromise;
  }
  
  _save() {
    const fs = require('fs');
    const data = this.db.export();
    const buf = Buffer.from(data);
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.filePath, buf);
  }
  
  exec(sql) {
    if (!this.db) throw new Error('[db-sqljs] 未初始化，请先调用 init()');
    this.db.exec(sql);
    this._save();
  }
  
  prepare(sql) {
    if (!this.db) throw new Error('[db-sqljs] 未初始化，请先调用 init()');
    const self = this;
    const stmt = this.db.prepare(sql);
    
    return {
      run(...args) {
        stmt.run(args);
        self._save();
        return { lastInsertRowid: self.db.exec('SELECT last_insert_rowid() AS id')[0].values[0][0], changes: 0 };
      },
      get(...args) {
        stmt.run(args);
        if (!stmt.step()) return undefined;
        const cols = stmt.getColumnNames();
        const vals = stmt.get();
        stmt.reset();
        const obj = {};
        for (let i = 0; i < cols.length; i++) obj[cols[i]] = vals[i];
        return obj;
      },
      all(...args) {
        stmt.run(args);
        const cols = stmt.getColumnNames();
        const rows = [];
        while (stmt.step()) {
          const vals = stmt.get();
          const obj = {};
          for (let i = 0; i < cols.length; i++) obj[cols[i]] = vals[i];
          rows.push(obj);
        }
        stmt.reset();
        return rows;
      },
      reset() { stmt.reset(); return this; },
      finalize() { try { stmt.free(); } catch(e) {} }
    };
  }
  
  close() {
    if (this.db) {
      this._save();
      this.db.close();
      this.db = null;
      this._ready = false;
    }
  }
}

module.exports = { DatabaseSync, init };
