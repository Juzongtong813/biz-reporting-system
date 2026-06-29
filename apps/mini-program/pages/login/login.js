const { wechatLogin, wechatRegister } = require('../../utils/auth');
const { BASE_URL } = require('../../utils/constants');

Page({
  data: {
    loading: false,
    registerLoading: false,
    showRegister: false,
    name: '',
    selectedCity: null,
    cityList: [],
    errorMsg: '',
    agreePrivacy: false,
  },

  onLoad() {
    // 提前加载城市列表（公开接口）
    this.loadCityList();
  },

  onAgreePrivacyChange() {
    this.setData({ agreePrivacy: !this.data.agreePrivacy });
  },

  /** 打开用户服务协议 */
  onOpenTerms() {
    wx.navigateTo({ url: '/pages/terms/terms' });
  },

  /** 打开隐私政策 */
  onOpenPrivacy() {
    wx.navigateTo({ url: '/pages/privacy/privacy' });
  },

  handleLogin() {
    if (!this.data.agreePrivacy) {
      wx.showToast({ title: '请先阅读并同意协议与隐私政策', icon: 'none' });
      return;
    }

    this.setData({ loading: true, errorMsg: '' });

    wechatLogin()
      .then((res) => {
        if (res.needRegister) {
          this.setData({
            showRegister: true,
            loading: false,
          });
        } else {
          wx.redirectTo({ url: '/pages/index/index' });
        }
      })
      .catch((err) => {
        this.setData({
          loading: false,
          errorMsg: err.message || '登录失败',
        });
      });
  },

  loadCityList() {
    // 使用裸 wx.request，避免 request.js 的 401 redirect 重置登录页状态
    wx.request({
      url: `${BASE_URL}/cities`,
      method: 'GET',
      header: { 'Content-Type': 'application/json' },
      success: (res) => {
        if (res.statusCode === 200) {
          this.setData({ cityList: res.data });
        } else {
          this.setData({ cityList: [] });
        }
      },
      fail: () => {
        this.setData({ cityList: [] });
      },
    });
  },

  onNameInput(e) {
    this.setData({ name: e.detail.value });
  },

  onCityChange(e) {
    const index = e.detail.value;
    this.setData({
      selectedCity: this.data.cityList[index],
    });
  },

  handleRegister() {
    // agreePrivacy 已在登录步骤确认，注册态不重复校验
    const { name, selectedCity } = this.data;
    if (!name.trim()) {
      this.setData({ errorMsg: '请输入姓名' });
      return;
    }
    if (!selectedCity) {
      this.setData({ errorMsg: '请选择城市' });
      return;
    }

    this.setData({ registerLoading: true, errorMsg: '' });

    wechatRegister(name.trim(), selectedCity.id)
      .then(() => {
        wx.redirectTo({ url: '/pages/index/index' });
      })
      .catch((err) => {
        this.setData({
          registerLoading: false,
          errorMsg: err.message || '注册失败',
        });
      });
  },

  backToLogin() {
    this.setData({
      showRegister: false,
      errorMsg: '',
      name: '',
      selectedCity: null,
    });
  },
});
