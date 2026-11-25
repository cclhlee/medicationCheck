// 本機開發用的常駐伺服器。部署到 Vercel 時走的是 api/ 底下的 serverless functions，
// 兩邊共用 lib/api.js 的同一份邏輯。
const { createServer } = require('node:http');
const { readFileSync } = require('node:fs');
const { handleUsers, handleSchedules } = require('./lib/api');

const demo = process.argv.includes('--demo');
if (!demo && !process.env.DATABASE_URL) throw new Error('請設定 DATABASE_URL');

let connect;
if (demo) {
  const pglite = new (require('@electric-sql/pglite').PGlite)();
  const ready = pglite.exec(readFileSync(__dirname + '/seed.sql', 'utf8'));
  connect = async () => {
    await ready;
    return { query: (text, values) => pglite.query(text, values), schema: 'week10' };
  };
} else {
  const { db } = require('./lib/db');
  connect = async () => db();
}

const page = readFileSync(__dirname + '/index.html');
const port = process.env.PORT || 3000;

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(page);
  }
  if (url.pathname === '/api/users') return handleUsers(req, res, await connect());
  if (url.pathname === '/api/schedules') return handleSchedules(req, res, await connect());
  res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ error: '找不到路徑' }));
}).listen(port, '127.0.0.1', () => console.log('開啟 http://localhost:' + port));
