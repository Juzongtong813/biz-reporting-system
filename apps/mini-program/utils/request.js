const { BASE_URL } = require('./constants');

/**
 * 统一网络请求封装
 */
function request(options) {
  return new Promise((resolve, reject) => {
    const token = wx.getStorageSync('token');
    wx.request({
      url: `${BASE_URL}${options.url}`,
      method: options.method || 'GET',
      data: options.data,
      header: {
        'Authorization': token ? `Bearer ${token}` : '',
        'Content-Type': 'application/json',
      },
      success: (res) => {
        if (res.statusCode === 401) {
          wx.removeStorageSync('token');
          wx.redirectTo({ url: '/pages/login/login' });
          reject({ code: 401, message: '登录已过期' });
          return;
        }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
        } else {
          reject({
            code: res.statusCode,
            message: (res.data && res.data.message) || '请求失败',
          });
        }
      },
      fail: (err) => {
        reject({ code: -1, message: '网络错误', detail: err });
      },
    });
  });
}

module.exports = { request, BASE_URL };
