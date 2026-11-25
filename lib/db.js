const { Pool } = require('pg');

// pg 的 ConnectionParameters 是 Object.assign({}, config, parse(connectionString))，
// 連線字串解析出的值會覆蓋我們傳入的 ssl 設定。而新版 pg 把 sslmode=require 當成
// verify-full，碰上 Supabase pooler 的自簽根憑證就會 SELF_SIGNED_CERT_IN_CHAIN。
// 因此把 sslmode 從字串剝掉，TLS 一律由下面的 sslOption() 單一決定。
function stripSslParams(connectionString) {
  const index = connectionString.indexOf('?');
  if (index === -1) return connectionString;
  const base = connectionString.slice(0, index);
  const kept = connectionString
    .slice(index + 1)
    .split('&')
    .filter(part => part && !/^(sslmode|uselibpqcompat)=/i.test(part));
  return kept.length ? base + '?' + kept.join('&') : base;
}

function hostOf(connectionString) {
  const match = /^[a-z+]+:\/\/(?:[^@/]*@)?([^:/?]+)/i.exec(connectionString);
  return match ? match[1] : '';
}

// Supabase 等雲端資料庫一律走 TLS；本機 PostgreSQL 預設不開。可用 DB_SSL=on/off 覆寫。
// 要完整驗證憑證鏈時，把 Supabase 的 CA 憑證 PEM 內容放進 DB_SSL_CA。
function sslOption(connectionString) {
  if (process.env.DB_SSL === 'off') return false;
  const host = hostOf(connectionString);
  const local = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (local && process.env.DB_SSL !== 'on') return false;
  if (process.env.DB_SSL_CA) return { ca: process.env.DB_SSL_CA, rejectUnauthorized: true };
  return { rejectUnauthorized: false };
}

// Vercel 的 Supabase integration 會自動寫入 POSTGRES_URL_NON_POOLING（session pooler，
// port 5432）與 POSTGRES_URL（transaction pooler，port 6543），且會隨密碼輪替自動更新。
// 優先用自己設定的 DATABASE_URL，其次沿用 integration 提供的，避免手動複製而過期。
const CONNECTION_VARS = ['DATABASE_URL', 'POSTGRES_URL_NON_POOLING', 'POSTGRES_URL'];

function connectionString() {
  for (const name of CONNECTION_VARS) {
    const value = process.env[name];
    if (value && value.trim()) return value.trim();
  }
  return '';
}

// Serverless 的同一個執行實例會重複處理請求，連線池要快取在模組層級。
let pool;

function db() {
  const raw = connectionString();
  if (!raw) throw new Error('請設定 DATABASE_URL（或由 Supabase integration 提供 POSTGRES_URL）');
  if (!pool) {
    pool = new Pool({
      connectionString: stripSslParams(raw),
      connectionTimeoutMillis: 5000,
      // 每個 serverless 實例只保留少量連線，避免打爆 Supabase 的連線上限。
      max: Number(process.env.DB_POOL_MAX || 1),
      idleTimeoutMillis: 10000,
      ssl: sslOption(raw),
    });
    pool.on('error', error => console.error('資料庫連線中斷', error.code));
  }
  // 一定要 trim：用 CLI 以管線設定環境變數時容易夾帶換行，
  // 夾了 \r 的 schema 加上引號後會變成不存在的識別字，查詢直接 42P01。
  const schema = (process.env.DB_SCHEMA || '').trim() || 'public';
  return { query: (text, values) => pool.query(text, values), schema };
}

module.exports = { db };
