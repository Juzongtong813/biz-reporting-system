const { BASE_URL } = require('./constants');

/**
 * 微信登录
 * 使用裸 wx.request（不经过 request.js），避免 401 自动 redirect 导致登录页状态重置。
 */
function wechatLogin() {
  return new Promise((resolve, reject) => {
    wx.login({
      success: (res) => {
        if (!res.code) {
          reject({ message: '微信登录失败' });
          return;
        }
        wx.request({
          url: `${BASE_URL}/auth/wechat/login`,
          method: 'POST',
          data: { code: res.code },
          header: { 'Content-Type': 'application/json' },
          success: (apiRes) => {
            if (apiRes.statusCode === 200) {
              const data = apiRes.data;
              wx.setStorageSync('token', data.token);
              wx.setStorageSync('userInfo', data.user);
              resolve(data);
            } else if (apiRes.statusCode === 404) {
              // 未注册
              resolve({ needRegister: true, code: res.code });
            } else {
              reject({
                code: apiRes.statusCode,
                message: (apiRes.data && apiRes.data.message) || '登录失败',
              });
            }
          },
          fail: (err) => {
            reject({ code: -1, message: '网络错误', detail: err });
          },
        });
      },
      fail: (err) => {
        reject({ code: -1, message: '微信登录失败', detail: err });
      },
    });
  });
}

/**
 * 微信注册
 * 不依赖外部 code（已过期），内部重新 wx.login 获取新 code。
 */
function wechatRegister(name, cityId) {
  return new Promise((resolve, reject) => {
    wx.login({
      success: (loginRes) => {
        if (!loginRes.code) {
          reject({ message: '微信登录失败' });
          return;
        }
        wx.request({
          url: `${BASE_URL}/auth/wechat/register`,
          method: 'POST',
          data: { code: loginRes.code, name, cityId },
          header: { 'Content-Type': 'application/json' },
          success: (apiRes) => {
            if (apiRes.statusCode === 200 || apiRes.statusCode === 201) {
              const data = apiRes.data;
              wx.setStorageSync('token', data.token);
              wx.setStorageSync('userInfo', data.user);
              resolve(data);
            } else {
              reject({
                code: apiRes.statusCode,
                message: (apiRes.data && apiRes.data.message) || '注册失败',
              });
            }
          },
          fail: (err) => {
            reject({ code: -1, message: '网络错误', detail: err });
          },
        });
      },
      fail: (err) => {
        reject({ code: -1, message: '微信登录失败', detail: err });
      },
    });
  });
}

/**
 * 获取当前用户信息（登录态页面使用，可用 request.js）
 */
function getMe() {
  const { request } = require('./request');
  return request({ url: '/me' });
}

module.exports = { wechatLogin, wechatRegister, getMe };
