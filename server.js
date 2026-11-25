const { createServer } = require('node:http');
const { readFileSync } = require('node:fs');
const { Pool } = require('pg');

const demo = process.argv.includes('--demo');
if (!demo && !process.env.DATABASE_URL) throw new Error('請設定 DATABASE_URL');
const pool = demo ? new (require('@electric-sql/pglite').PGlite)() : new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
if (!demo) pool.on('error', error => console.error('資料庫連線中斷', error.code));
const ready = demo ? pool.exec(readFileSync(__dirname + '/seed.sql', 'utf8')) : Promise.resolve();
const page = readFileSync(__dirname + '/index.html');
const schema = demo ? 'week10' : (process.env.DB_SCHEMA || 'public');
const schemaSql = '"' + schema.replaceAll('"', '""') + '"';
const columns = '時程ID, 使用者ID, 藥名, 劑量, 服用時間, 頻率';
const validId = value => Number.isInteger(value) && value > 0 && value <= 2147483647;

createServer(async (req, res) => {
  const send = (status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
  };
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(page);
  }
  if (!['/api/schedules', '/api/users'].includes(url.pathname)) return send(404, { error: '找不到路徑' });

  try {
    await ready;
    if (url.pathname === '/api/users') {
      if (req.method !== 'GET') return send(405, { error: '請使用 GET' });
      const result = await pool.query('SELECT 使用者ID AS id, 姓名 AS name FROM ' + schemaSql + '.使用者 ORDER BY 使用者ID');
      return send(200, result.rows);
    }
    if (req.method === 'GET') {
      const userId = Number(url.searchParams.get('userId'));
      if (!validId(userId)) return send(400, { error: '請提供有效的使用者 ID' });
      const result = await pool.query(
        'SELECT ' + columns + ' FROM ' + schemaSql + '.用藥時程 WHERE 使用者ID = $1 ORDER BY 服用時間, 時程ID',
        [userId]
      );
      return send(200, result.rows);
    }
    if (req.method !== 'POST') return send(405, { error: '請使用 GET 或 POST' });
    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 4096) {
        send(413, { error: '資料太長' });
        return;
      }
    }
    let body;
    try { body = JSON.parse(raw); } catch { return send(400, { error: '需要有效的 JSON' }); }
    const { userId, name, dose, time, frequency } = body ?? {};
    const fits = (value, limit) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= limit;
    if (!validId(userId) || !fits(name, 50) || !fits(dose, 20) ||
        typeof time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time) ||
        (frequency != null && !fits(frequency, 20))) {
      return send(400, { error: '請檢查使用者、名稱、劑量、時間和頻率' });
    }
    const result = await pool.query(
      'INSERT INTO ' + schemaSql + '.用藥時程 (使用者ID, 藥名, 劑量, 服用時間, 頻率) VALUES ($1,$2,$3,$4,$5) RETURNING ' + columns,
      [userId, name.trim(), dose.trim(), time, frequency?.trim() ?? null]
    );
    send(201, result.rows[0]);
  } catch (error) {
    if (error.code === '23503') return send(400, { error: '找不到這位測試使用者' });
    console.error('資料庫操作失敗', error.code);
    send(503, { error: '資料庫暫時無法使用，請檢查連線設定、DB_SCHEMA 和資料表' });
  }
}).listen(process.env.PORT || 3000, '127.0.0.1', () => console.log('開啟 http://localhost:' + (process.env.PORT || 3000)));
