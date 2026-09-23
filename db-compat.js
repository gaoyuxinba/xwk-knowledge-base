'use strict';
let DatabaseSync;
try {
  DatabaseSync = require('node:sqlite').DatabaseSync;
} catch (e) {
  DatabaseSync = require('better-sqlite3');
}
module.exports = { DatabaseSync };
