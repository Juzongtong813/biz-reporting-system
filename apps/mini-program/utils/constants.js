/**
 * API 配置
 *
 * 环境检测机制：
 * - config.prod.js 存在且配置有效 → 所有环境走生产域名（含开发者工具）
 * - config.prod.js 不存在 → develop 走 localhost，trial/release 抛错阻止启动
 *
 * 生产环境配置（部署前执行）：
 *   1. 复制 config.default.js 为 config.prod.js
 *   2. 修改 config.prod.js 中的 PROD_API_HOST 为云托管域名
 *   3. config.prod.js 已加入 .gitignore，不会误提交占位符
 *
 * 安全机制：
 * - 如果 trial / release 环境未配置 PROD_API_HOST，会抛错阻止启动
 * - 避免上线后因占位符遗漏导致请求 404
 */

// 尝试加载生产配置，不存在则用默认配置
let prodConfig;
try {
  prodConfig = require('./config.prod.js');
} catch (e) {
  prodConfig = require('./config.default.js');
}

const PROD_API_HOST = prodConfig.PROD_API_HOST;

function getApiHost() {
  // 只要 config.prod.js 存在且配置了有效域名，所有环境都走生产
  if (PROD_API_HOST && PROD_API_HOST !== '__PROD_API_HOST_NOT_CONFIGURED__') {
    return PROD_API_HOST;
  }

  // config.prod.js 不存在时，开发环境走 localhost
  // trial / release 无配置 → 抛错阻止启动
  try {
    const info = wx.getAccountInfoSync();
    const env = info.miniProgram.envVersion;
    // miniProgram.envVersion: 'develop' | 'trial' | 'release'
    if (env === 'release' || env === 'trial') {
      throw new Error(
        '[biz-reporting] 生产环境 API_HOST 未配置！\n' +
        '请复制 utils/config.default.js 为 config.prod.js，\n' +
        '并将其中的 PROD_API_HOST 替换为云托管域名。'
      );
    }
  } catch (e) {
    if (e.message && e.message.includes('PROD_API_HOST')) {
      throw e;
    }
  }
  return 'http://localhost:3000';
}

const API_HOST = getApiHost();
const API_PREFIX = '/api';
const BASE_URL = `${API_HOST}${API_PREFIX}`;

module.exports = { API_HOST, API_PREFIX, BASE_URL };
