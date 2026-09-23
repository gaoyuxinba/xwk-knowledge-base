/**
 * 外网穿透：把本机服务暴露为公网地址（带断线自动重连）
 *
 * 用法：先启动后端（npm start 或 启动服务.bat），再运行本脚本（或 启动外网访问.bat）
 *
 * localtunnel 免费服务会不定期主动断开连接（表现为访问返回 503 Tunnel Unavailable）。
 * 本脚本在检测到隧道关闭/出错后会自动重连，尽量保持公网地址可用。
 * 注意：重连后地址可能变化；若配置了 SUBDOMAIN 则通常会保持同一个地址。
 */
'use strict';

const localtunnel = require('localtunnel');
const http = require('http');

const PORT = Number(process.env.PORT || 3210);
const SUBDOMAIN = process.env.SUBDOMAIN || 'xwk-knowledge-base';
const RETRY_BASE_MS = Number(process.env.TUNNEL_RETRY_MS || 5000);
const RETRY_MAX_MS = Number(process.env.TUNNEL_RETRY_MAX_MS || 60000);

let retryDelay = RETRY_BASE_MS;
let currentTunnel = null;
let shuttingDown = false;

function waitServer() {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/healthz', timeout: 2000 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function printBanner(url) {
  console.log('');
  console.log('  公网访问地址：' + url);
  console.log('');
  console.log('  使用说明：');
  console.log('  1. 首次打开该地址，localtunnel 会显示一个确认页，');
  console.log('     输入你的公网 IP（可到 https://loca.lt/mytunnelpassword 查询）即可进入登录页。');
  console.log('  2. 登录账号：见后台「系统自检与设置」页说明。');
  console.log('  3. 这个终端窗口必须保持打开，关闭即断网。');
  console.log('  4. 隧道若被服务端断开，本脚本会自动重连（最多等 ' + (RETRY_MAX_MS / 1000) + ' 秒）。');
  console.log('');
  console.log('='.repeat(64));
}

async function openTunnel() {
  const opts = { port: PORT };
  if (SUBDOMAIN) opts.subdomain = SUBDOMAIN;
  return localtunnel(opts);
}

async function main() {
  console.log('='.repeat(64));
  console.log('外网穿透启动中…');
  console.log('='.repeat(64));

  const up = await waitServer();
  if (!up) {
    console.warn(`[警告] 本机 ${PORT} 端口没有检测到运行中的服务。`);
    console.warn('       请先在另一个终端启动后端（npm start）。');
    console.warn('       隧道仍会建立，但访问会返回 502/503。');
  }

  let first = true;
  while (!shuttingDown) {
    try {
      const tunnel = await openTunnel();
      currentTunnel = tunnel;
      retryDelay = RETRY_BASE_MS;   // 连上了就重置退避
      printBanner(tunnel.url);

      // 等隧道关闭或出错，然后进入下一轮重连
      await new Promise((resolve) => {
        tunnel.on('close', () => {
          if (!shuttingDown) console.log('\n[提示] 隧道已关闭，准备自动重连…');
          resolve();
        });
        tunnel.on('error', (e) => {
          if (!shuttingDown) console.error('\n[隧道错误]', e.message, ' 准备自动重连…');
          try { tunnel.close(); } catch { /* 忽略 */ }
          resolve();
        });
      });
      if (shuttingDown) break;
    } catch (e) {
      console.error('[建立隧道失败]', e.message);
    }

    if (shuttingDown) break;
    console.log(`  ${Math.round(retryDelay / 1000)} 秒后重试…`);
    await sleep(retryDelay);
    retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
    first = false;
  }
  console.log('\n隧道已停止。');
}

process.on('SIGINT', () => {
  shuttingDown = true;
  console.log('\n正在关闭隧道…');
  try { currentTunnel && currentTunnel.close(); } catch { /* 忽略 */ }
  process.exit(0);
});
process.on('SIGTERM', () => {
  shuttingDown = true;
  try { currentTunnel && currentTunnel.close(); } catch { /* 忽略 */ }
  process.exit(0);
});

main();
