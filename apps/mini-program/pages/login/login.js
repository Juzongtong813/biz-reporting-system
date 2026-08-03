const { wechatLogin, wechatBind } = require('../../utils/auth');

Page({
  data: {
    loading: false,
    bindLoading: false,
    showBind: false,
    invitationToken: '',
    errorMsg: '',
    agreePrivacy: false,
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
        if (res.needBind) {
          this.setData({
            showBind: true,
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

  onInvitationInput(e) {
    this.setData({ invitationToken: e.detail.value });
  },

  handleBind() {
    const invitationToken = this.data.invitationToken.trim();
    if (!invitationToken) {
      this.setData({ errorMsg: '请输入微信绑定邀请' });
      return;
    }

    this.setData({ bindLoading: true, errorMsg: '' });

    wechatBind(invitationToken)
      .then(() => wechatLogin())
      .then(() => wx.redirectTo({ url: '/pages/index/index' }))
      .catch((err) => {
        this.setData({
          bindLoading: false,
          errorMsg: err.message || '邀请绑定失败',
        });
      });
  },

  backToLogin() {
    this.setData({
      showBind: false,
      errorMsg: '',
      invitationToken: '',
    });
  },
});
