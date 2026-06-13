// Node.js 后端示例：基岩版服务器状态记录与查询
// 依赖：express、mysql2、node-cron、minecraft-server-util、cors
// 安装：npm install express mysql2 node-cron minecraft-server-util cors

const express = require('express');
const mysql = require('mysql2/promise');
const cron = require('node-cron');
const cors = require('cors');   // ← 必须写在这里
const { statusBedrock } = require('minecraft-server-util');

// ================== 配置区域 ==================
const port = 3000;

// MySQL 配置
const dbConfig = {
  host: 'localhost',
  user: 'mc_status',
  password: 'tiLP2eDrZd2cXYzW',
  database: 'mc_status'
};

// 服务器信息
const serverHost = 'mc.qyserver.top';
const serverPort = 41657;
// =================================================

// 创建 Express 应用
const app = express();

// 启用 CORS（网页跨域访问 API 必须）
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}));

// ========== 服务器状态检查函数 ==========
async function checkServerStatus() {
  try {
    const result = await statusBedrock(serverHost, serverPort, {
      timeout: 10000,
      enableSRV: true
    });
    return { success: true, data: result };
  } catch (err) {
    console.error('服务器状态检查失败:', err.message);
    return { success: false, error: err.message };
  }
}

// ========== 初始化：确保数据库与表存在，然后再启动定时任务与路由 ==========
const dbName = 'mc_status';
const dbTable = 'mc_status';

async function initDb() {
  try {
    const rootConn = await mysql.createConnection({
      host: dbConfig.host,
      user: dbConfig.user,
      password: dbConfig.password,
      multipleStatements: true
    });

    await rootConn.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`);

    await rootConn.query(
      `CREATE TABLE IF NOT EXISTS \`${dbName}\`.\`${dbTable}\` (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        time DATETIME NOT NULL,
        online INT NOT NULL DEFAULT 0,
        max INT NOT NULL DEFAULT 0,
        status TINYINT NOT NULL DEFAULT 0
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`
    );

    await rootConn.end();
    console.log(`确保数据库与表存在: ${dbName}.${dbTable}`);
  } catch (err) {
    console.error('初始化数据库失败:', err);
    throw err;
  }
}

async function start() {
  await initDb();

  // ========== 定时任务：每 2 分钟记录一次状态 ==========
  cron.schedule('*/2 * * * *', async () => {
    const statusResult = await checkServerStatus();

    try {
      const conn = await mysql.createConnection(dbConfig);

      if (statusResult.success) {
        await conn.execute(
          'INSERT INTO mc_status (time, online, max, status) VALUES (?, ?, ?, ?)',
          [new Date(), statusResult.data.players?.online || 0, statusResult.data.players?.max || 0, 1]
        );
        console.log('记录成功:', new Date());
      } else {
        await conn.execute(
          'INSERT INTO mc_status (time, online, max, status) VALUES (?, ?, ?, ?)',
          [new Date(), 0, 0, 0]
        );
        console.error('记录失败:', statusResult.error);
      }

      await conn.end();
    } catch (dbErr) {
      console.error('数据库操作失败:', dbErr);
    }
  });

  // ========== 定时任务：清除 2 小时前的记录 ==========
  cron.schedule('*/2 * * * *', async () => {
    try {
      const conn = await mysql.createConnection(dbConfig);
      const [result] = await conn.execute(
        'DELETE FROM mc_status WHERE time < DATE_SUB(NOW(), INTERVAL 2 HOUR)'
      );
      await conn.end();
      console.log('已清除 2 小时前记录:', result.affectedRows, '时间:', new Date());
    } catch (err) {
      console.error('清除记录失败:', err);
    }
  });

  // ========== API：获取最近 2 小时记录 ==========
  app.get('/api/history', async (req, res) => {
    try {
      const conn = await mysql.createConnection(dbConfig);
      const [rows] = await conn.execute(
        'SELECT time, online, status FROM mc_status WHERE time > DATE_SUB(NOW(), INTERVAL 2 HOUR) ORDER BY time DESC'
      );
      await conn.end();
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: '数据库查询失败' });
    }
  });

  // ========== 缓存：5秒内复用上次查询结果 ==========
  let statusCache = null;
  let cacheTime = 0;
  const CACHE_TTL = 5000;

  // ========== API：实时获取服务器状态（带 5 秒缓存） ==========
  app.get('/api/status', async (req, res) => {
    const now = Date.now();
    if (statusCache && (now - cacheTime) < CACHE_TTL) {
      return res.json(statusCache);
    }

    const statusResult = await checkServerStatus();

    if (statusResult.success) {
      statusCache = {
        online: true,
        players: {
          online: statusResult.data.players?.online || 0,
          max: statusResult.data.players?.max || 0
        },
        motd: statusResult.data.motd?.clean || 'Unknown',
        version: statusResult.data.version
      };
      cacheTime = now;
      res.json(statusCache);
    } else {
      res.json({
        online: false,
        error: statusResult.error
      });
    }
  });

  // ========== 启动服务 ==========
  app.listen(port, () => {
    console.log(`MC 状态服务已启动: http://localhost:${port}`);
  });
}

start().catch(err => {
  console.error('启动失败:', err);
  process.exit(1);
});
