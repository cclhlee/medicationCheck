const { handleUsers, send } = require('../lib/api');
const { db } = require('../lib/db');

module.exports = async (req, res) => {
  try {
    await handleUsers(req, res, db());
  } catch (error) {
    console.error('設定錯誤', error.message);
    send(res, 503, { error: '伺服器尚未設定 DATABASE_URL' });
  }
};
