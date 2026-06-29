const { BASE_URL } = require('../../utils/constants');

Page({
  data: {
    loading: true,
    status: 'loading',
    messages: [],
    unreadCount: 0,
    errorMessage: '',
    isLoggedIn: false,
  },

  onLoad() {
    this.loadMessages();
  },

  onShow() {
    this.loadMessages();
  },

  loadMessages() {
    const token = wx.getStorageSync('token');
    if (!token) {
      this.setData({
        loading: false,
        status: 'guest',
        messages: [],
        unreadCount: 0,
        errorMessage: '',
        isLoggedIn: false,
      });
      return;
    }

    this.setData({
      loading: true,
      status: 'loading',
      errorMessage: '',
      isLoggedIn: true,
    });

    wx.request({
      url: BASE_URL + '/messages',
      method: 'GET',
      header: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      success: (res) => {
        if (res.statusCode === 200) {
          const msgList = (res.data.messages || []).map((m) => {
            let time = m.createdAt || '';
            if (time) {
              time = time.slice(0, 16).replace('T', ' ');
            }
            return {
              id: m.id,
              title: m.title,
              summary: m.summary,
              isRead: m.isRead,
              createdAt: time,
              payloadJson: m.payloadJson || null,
            };
          });

          this.setData({
            messages: msgList,
            unreadCount: Number(res.data.unreadCount || 0),
            loading: false,
            status: msgList.length ? 'ready' : 'empty',
          });
          return;
        }

        this.setData({
          loading: false,
          status: 'error',
          errorMessage: (res.data && res.data.message) || '加载消息失败',
        });
      },
      fail: () => {
        this.setData({
          loading: false,
          status: 'error',
          errorMessage: '网络开小差了，消息暂时加载失败',
        });
      },
    });
  },

  markMessageRead(messageId) {
    const token = wx.getStorageSync('token');
    if (!token) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      wx.request({
        url: BASE_URL + '/messages/' + messageId + '/read',
        method: 'POST',
        header: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        complete: () => resolve(),
      });
    });
  },

  onMsgTap(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) {
      return;
    }

    this.markMessageRead(id).finally(() => {
      this.loadMessages();
    });
  },

  onRetryTap() {
    this.loadMessages();
  },
});
