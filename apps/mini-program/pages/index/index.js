const { request, BASE_URL } = require('../../utils/request');

Page({
  data: {
    year: new Date().getFullYear(),
    isLoggedIn: false,
    userInfo: {},
    pkgStatus: 'loading',
    packageData: null,
    months: [],
    stats: {
      submitted: 0,
      pending: 0,
      overdue: 0,
      contractCount: 0,
    },
    summary: {
      completionTotal: 0,
      acceptanceTotal: 0,
      costTotal: 0,
      grossProfit: 0,
    },
    summaryCompletionDisplay: '0.00',
    summaryAcceptanceDisplay: '0.00',
    summaryCostDisplay: '0.00',
    summaryProfitDisplay: '0.00',
    enableMaintenance: false,
    unreadCount: 0,
    pkgErrorMessage: '',
  },

  onLoad() {
    this.checkAuthAndLoad();
  },

  onShow() {
    this.checkAuthAndLoad();
    this.refreshUnreadCount();
  },

  checkAuthAndLoad() {
    const token = wx.getStorageSync('token');
    if (!token) {
      this.setData({ isLoggedIn: false, unreadCount: 0 });
      return;
    }

    wx.request({
      url: `${BASE_URL}/me`,
      header: { Authorization: `Bearer ${token}` },
      success: (res) => {
        if (res.statusCode === 200) {
          this.setData({ isLoggedIn: true, userInfo: res.data });
          this.loadPackage(this.data.year);
          this.loadCityConfig();
          this.refreshUnreadCount();
        } else {
          this.clearTokenAndShowGuest();
        }
      },
      fail: () => {
        this.setData({ isLoggedIn: true });
        this.refreshUnreadCount();
      },
    });
  },

  refreshUnreadCount() {
    const token = wx.getStorageSync('token');
    if (!token) {
      this.setData({ unreadCount: 0 });
      return;
    }

    wx.request({
      url: `${BASE_URL}/messages/unread-count`,
      header: { Authorization: `Bearer ${token}` },
      success: (res) => {
        if (res.statusCode === 200) {
          this.setData({ unreadCount: Number(res.data.unreadCount || 0) });
        }
      },
    });
  },

  clearTokenAndShowGuest() {
    wx.removeStorageSync('token');
    wx.removeStorageSync('userInfo');
    wx.removeStorageSync('cityId');
    this.setData({ isLoggedIn: false, userInfo: {}, unreadCount: 0 });
  },

  loadPackage(year) {
    request({
      url: `/city/packages/current?year=${year}`,
    })
      .then((data) => {
        const months = [];
        if (data.months) {
          for (let m = 1; m <= 12; m++) {
            const monthData = data.months.find((mth) => mth.monthNo === m);
            months.push({
              monthNo: m,
              submitted: monthData ? monthData.submitted : false,
            });
          }
        } else {
          for (let m = 1; m <= 12; m++) {
            months.push({ monthNo: m, submitted: false });
          }
        }

        const submittedCount = months.filter((m) => m.submitted).length;
        const overdueCount = data.months
          ? data.months.filter((m) => m.overdue && !m.submitted).length
          : 0;
        const pendingCount = 12 - submittedCount - overdueCount;
        const contractCount = data.contractCount || 0;

        this.setData({
          pkgStatus: 'loaded',
          packageData: data,
          months,
          stats: {
            submitted: submittedCount,
            pending: pendingCount,
            overdue: overdueCount,
            contractCount,
          },
          summary: {
            completionTotal: Number(data.summary?.completionTotal || 0),
            acceptanceTotal: Number(data.summary?.acceptanceTotal || 0),
            costTotal: Number(data.summary?.costTotal || 0),
            grossProfit: Number(data.summary?.grossProfit || 0),
          },
          summaryCompletionDisplay: this.fmt(Number(data.summary?.completionTotal || 0)),
          summaryAcceptanceDisplay: this.fmt(Number(data.summary?.acceptanceTotal || 0)),
          summaryCostDisplay: this.fmt(Number(data.summary?.costTotal || 0)),
          summaryProfitDisplay: this.fmt(Number(data.summary?.grossProfit || 0)),
        });
      })
      .catch((err) => {
        const message = (err && err.message) ? err.message : '加载失败';
        this.setData({ pkgStatus: 'error', pkgErrorMessage: message });
      });
  },

  loadCityConfig() {
    request({ url: '/city/configs' })
      .then((data) => {
        this.setData({ enableMaintenance: data.enableMaintenance });
      })
      .catch(() => {
      });
  },

  onRetryLoadPkg() {
    this.setData({ pkgStatus: 'loading', pkgErrorMessage: '' });
    this.loadPackage(this.data.year);
  },

  onMonthTap(e) {
    if (!this.data.isLoggedIn) {
      wx.showModal({
        title: '请先登录',
        content: '填报数据需要微信登录验证身份。',
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

  onLoginTap() {
    wx.navigateTo({ url: '/pages/login/login' });
  },

  onMaintenanceTap() {
    if (!this.data.packageData || !this.data.packageData.id) return;

    const monthNo = new Date().getMonth() + 1;
    const month = this.data.months.find((item) => item.monthNo === monthNo);
    const pkgStatus = month && month.submitted ? 'submitted' : 'draft';

    wx.navigateTo({
      url: `/pages/package-month/package-month?packageId=${this.data.packageData.id}&monthNo=${monthNo}&enableMaintenance=${this.data.enableMaintenance}&pkgStatus=${pkgStatus}`,
    });
  },

  onMessagesTap() {
    wx.navigateTo({ url: '/pages/messages/messages' });
  },

  formatAmount(value) {
    return Number(value || 0).toFixed(2);
  },

  fmt(value) {
    return Number(value || 0).toFixed(2);
  },
});
