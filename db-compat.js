'use strict';
// Vercel 环境用纯 JS 内存数据库，本地环境用 node:sqlite 或 better-sqlite3
let DatabaseSync;
if (process.env.VERCEL) {
  DatabaseSync = require('./memory-db').DatabaseSync;
} else {
  try {
    DatabaseSync = require('node:sqlite').DatabaseSync;
  } catch (e) {
    DatabaseSync = require('better-sqlite3');
  }
}
module.exports = { DatabaseSync };
