const { BASE_URL } = require('./utils/constants');

App({
  globalData: {
    userInfo: null,
    cityId: null,
  },

  onLaunch() {
    const token = wx.getStorageSync('token');
    if (token) {
      this.checkLogin(token);
    }
  },

  checkLogin(token) {
    // 使用裸 wx.request，不触发 request.js 的 401 自动 redirect
    wx.request({
      url: `${BASE_URL}/me`,
      header: { Authorization: `Bearer ${token}` },
      success: (res) => {
        if (res.statusCode === 200) {
          this.globalData.userInfo = res.data;
          this.globalData.cityId = res.data.cityId;
        } else {
          wx.removeStorageSync('token');
        }
      },
      fail: () => {
        // 网络错误，不做清理，用户可手动重试
      },
    });
  },
});
