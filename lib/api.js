const columns = '時程ID, 使用者ID, 藥名, 劑量, 服用時間, 頻率';
const validId = value => Number.isInteger(value) && value > 0 && value <= 2147483647;
const fits = (value, limit) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= limit;

const send = (res, status, data) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
};

const table = (db, name) => '"' + db.schema.replaceAll('"', '""') + '".' + name;

const fail = (res, error) => {
  if (error.code === '23503') return send(res, 400, { error: '找不到這位測試使用者' });
  console.error('資料庫操作失敗', error.code || error.message);
  send(res, 503, { error: '資料庫暫時無法使用，請檢查連線設定、DB_SCHEMA 和資料表' });
};

// Vercel 會先把 application/json 的內容解析進 req.body，本機的 node:http 不會，兩邊都要支援。
async function readJson(req) {
  if (req.body != null) {
    if (typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return { body: req.body };
    const text = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body);
    try { return { body: JSON.parse(text) }; } catch { return { status: 400, error: '需要有效的 JSON' }; }
  }
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 4096) return { status: 413, error: '資料太長' };
  }
  try { return { body: JSON.parse(raw) }; } catch { return { status: 400, error: '需要有效的 JSON' }; }
}

async function handleUsers(req, res, db) {
  try {
    if (req.method !== 'GET') return send(res, 405, { error: '請使用 GET' });
    const result = await db.query('SELECT 使用者ID AS id, 姓名 AS name FROM ' + table(db, '使用者') + ' ORDER BY 使用者ID');
    send(res, 200, result.rows);
  } catch (error) {
    fail(res, error);
  }
}

async function handleSchedules(req, res, db) {
  try {
    if (req.method === 'GET') {
      const userId = Number(new URL(req.url, 'http://localhost').searchParams.get('userId'));
      if (!validId(userId)) return send(res, 400, { error: '請提供有效的使用者 ID' });
      const result = await db.query(
        'SELECT ' + columns + ' FROM ' + table(db, '用藥時程') + ' WHERE 使用者ID = $1 ORDER BY 服用時間, 時程ID',
        [userId]
      );
      return send(res, 200, result.rows);
    }
    if (req.method !== 'POST') return send(res, 405, { error: '請使用 GET 或 POST' });

    const parsed = await readJson(req);
    if (parsed.error) return send(res, parsed.status, { error: parsed.error });
    const { userId, name, dose, time, frequency } = parsed.body ?? {};
    if (!validId(userId) || !fits(name, 50) || !fits(dose, 20) ||
        typeof time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time) ||
        (frequency != null && !fits(frequency, 20))) {
      return send(res, 400, { error: '請檢查使用者、名稱、劑量、時間和頻率' });
    }
    const result = await db.query(
      'INSERT INTO ' + table(db, '用藥時程') + ' (使用者ID, 藥名, 劑量, 服用時間, 頻率) VALUES ($1,$2,$3,$4,$5) RETURNING ' + columns,
      [userId, name.trim(), dose.trim(), time, frequency?.trim() ?? null]
    );
    send(res, 201, result.rows[0]);
  } catch (error) {
    fail(res, error);
  }
}

module.exports = { handleUsers, handleSchedules, send };
