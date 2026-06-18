const { request, BASE_URL } = require('../../utils/request');

Page({
  data: {
    year: new Date().getFullYear(),
    isLoggedIn: false,
    userInfo: {},
    pkgStatus: 'loading',
    packageData: null,
    months: [],
    enableMaintenance: false,
  },

  onLoad() {
    this.checkAuthAndLoad();
  },

  onShow() {
    this.checkAuthAndLoad();
  },

  /**
   * 先验证 token 有效性，再决定进入哪种 UI。
   * 不用 request.js（避免 401 自动 redirect），直接用 wx.request。
   */
  checkAuthAndLoad() {
    const token = wx.getStorageSync('token');
    if (!token) {
      this.setData({ isLoggedIn: false });
      return;
    }

    // 有 token 时先验证有效性
    wx.request({
      url: `${BASE_URL}/me`,
      header: { Authorization: `Bearer ${token}` },
      success: (res) => {
        if (res.statusCode === 200) {
          this.setData({ isLoggedIn: true, userInfo: res.data });
          this.loadPackage(this.data.year);
          this.loadCityConfig();
        } else {
          this.clearTokenAndShowGuest();
        }
      },
      fail: () => {
        // 网络错误：不清理 token，保留登录状态等网络恢复
        // 显示已登录态但加载失败提示
        this.setData({ isLoggedIn: true, pkgStatus: 'empty' });
      },
    });
  },

  /** 清除无效 token，进入未登录可浏览态 */
  clearTokenAndShowGuest() {
    wx.removeStorageSync('token');
    wx.removeStorageSync('userInfo');
    wx.removeStorageSync('cityId');
    this.setData({ isLoggedIn: false, userInfo: {} });
  },

  loadPackage(year) {
    request({
      url: `/city/packages/current?year=${year}`,
    })
      .then((data) => {
        const months = [];
        // 构建月度列表（snapshot 或默认）
        if (data.months) {
          for (let m = 1; m <= 12; m++) {
            const monthData = data.months.find((mth) => mth.monthNo === m);
            months.push({
              monthNo: m,
              submitted: monthData && monthData.status === 'submitted',
            });
          }
        } else {
          for (let m = 1; m <= 12; m++) {
            months.push({ monthNo: m, submitted: false });
          }
        }

        this.setData({
          pkgStatus: 'loaded',
          packageData: data,
          months,
        });
      })
      .catch(() => {
        this.setData({ pkgStatus: 'empty' });
      });
  },

  loadCityConfig() {
    request({ url: '/city/configs' })
      .then((data) => {
        this.setData({ enableMaintenance: data.enableMaintenance });
      })
      .catch(() => {
        // 城市配置不存在时保持 false
      });
  },

  onMonthTap(e) {
    // 未登录时提示用户先登录
    if (!this.data.isLoggedIn) {
      wx.showModal({
        title: '请先登录',
        content: '填报数据需要微信登录验证身份',
        confirmText: '去登录',
        cancelText: '取消',
        success: (res) => {
          if (res.confirm) {
            wx.navigateTo({ url: '/pages/login/login' });
          }
        },
      });
      return;
    }

    const dataset = e.currentTarget.dataset;
    const packageId = this.data.packageData ? this.data.packageData.id : 0;
    if (!packageId) return;

    const monthNo = Number(dataset.month);
    const month = this.data.months.find((m) => m.monthNo === monthNo);
    const pkgStatus = month && month.submitted ? 'submitted' : 'draft';

    wx.navigateTo({
      url: `/pages/package-month/package-month?packageId=${packageId}&monthNo=${monthNo}&enableMaintenance=${this.data.enableMaintenance}&pkgStatus=${pkgStatus}`,
    });
  },

  /** 未登录状态下点击登录按钮 */
  onLoginTap() {
    wx.navigateTo({ url: '/pages/login/login' });
  },

  onMaintenanceTap() {
    wx.showToast({ title: '代维功能开发中', icon: 'none' });
  },
});
