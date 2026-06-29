const { request } = require('../../utils/request');

// 费用类别中文名映射
const COST_LABELS = {
  labor: '人工成本',
  utilities: '水电费',
  fuel: '油补',
  entertainment: '招待费',
  rent: '房租',
  reimbursement: '报销',
  other: '其他',
};

const COST_CATEGORY_CODES = Object.keys(COST_LABELS);

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

Page({
  data: {
    // 路由参数
    packageId: 0,
    monthNo: 0,
    year: new Date().getFullYear(),
    enableMaintenance: false,

    // 页面状态
    loading: true,
    isReadOnly: false,
    pkgStatus: 'draft',

    // 表单数据
    contractRows: [],
    costRows: [],
    maintenanceRow: null,

    // 汇总预览
    showPreview: false,
    previewData: null,

    // 操作状态
    saving: false,
    submitting: false,
  },

  onLoad(options) {
    const packageId = Number(options.packageId || 0);
    const monthNo = Number(options.monthNo || 0);
    const enableMaintenance = options.enableMaintenance === 'true';
    const pkgStatus = options.pkgStatus || 'draft';

    this.setData({ packageId, monthNo, enableMaintenance, pkgStatus }, () => {
      this.loadMonthData();
    });
  },

  /**
   * 加载月度数据
   */
  loadMonthData() {
    const { packageId, monthNo } = this.data;

    const url = this.data.pkgStatus === 'submitted'
      ? `/city/packages/${packageId}/read-only-months/${monthNo}`
      : `/city/packages/${packageId}/months/${monthNo}`;

    request({ url })
      .then((data) => {
        const isReadOnly = this.data.pkgStatus === 'submitted';
        this.setData({ loading: false, isReadOnly });

        // 已提交月份：数据在 data.snapshot 中
        // 草稿月份：数据在 data 根级
        const src = isReadOnly && data.snapshot ? data.snapshot : data;

        // 合同行
        if (src.contractRows && src.contractRows.length > 0) {
          const normalized = src.contractRows.map((r) => ({
            ...r,
            completionAmount: toNumber(r.completionAmount),
            acceptanceAmount: toNumber(r.acceptanceAmount),
          }));
          this.setData({ contractRows: normalized });
        }

        // 费用行（加上中文标签）
        if (src.costRows && src.costRows.length > 0) {
          const labeled = src.costRows.map((r) => ({
            ...r,
            amount: toNumber(r.amount),
            costCategoryLabel: COST_LABELS[r.costCategoryCode] || r.costCategoryCode,
          }));
          this.setData({ costRows: labeled });
        } else {
          this.initCostRows();
        }

        // 维保行（注意：快照中字段名为 maintenanceRows 对象，草稿中是 maintenanceRow）
        const maint = src.maintenanceRows || src.maintenanceRow;
        if (maint) {
          this.setData({
            maintenanceRow: {
              invoiceTotalPrevYear: toNumber(maint.invoiceTotalPrevYear),
              invoiceMonthCountPrevYear: toNumber(maint.invoiceMonthCountPrevYear),
              invoiceTotalCurrentYear: toNumber(maint.invoiceTotalCurrentYear),
            },
          });
        } else if (this.data.enableMaintenance) {
          this.setData({ maintenanceRow: { invoiceTotalPrevYear: 0, invoiceMonthCountPrevYear: 0, invoiceTotalCurrentYear: 0 } });
        }
      })
      .catch(() => {
        // 无数据时初始化
        this.setData({ loading: false, isReadOnly: false });
        this.initCostRows();
        if (this.data.enableMaintenance) {
          this.setData({ maintenanceRow: { invoiceTotalPrevYear: 0, invoiceMonthCountPrevYear: 0, invoiceTotalCurrentYear: 0 } });
        }
      });
  },

  /**
   * 初始化 7 类费用（含中文标签）
   */
  initCostRows() {
    const costRows = COST_CATEGORY_CODES.map((code) => ({
      costCategoryCode: code,
      amount: 0,
      costCategoryLabel: COST_LABELS[code] || code,
    }));
    this.setData({ costRows });
  },

  // ============================================================
  // 表单输入处理
  // ============================================================

  /** 合同行完工金额输入 */
  onContractCompletionInput(e) {
    const index = e.currentTarget.dataset.index;
    const value = Number(e.detail.value) || 0;
    const key = `contractRows[${index}].completionAmount`;
    this.setData({ [key]: value });
  },

  /** 合同行审定金额输入 */
  onContractAcceptanceInput(e) {
    const index = e.currentTarget.dataset.index;
    const value = Number(e.detail.value) || 0;
    const key = `contractRows[${index}].acceptanceAmount`;
    this.setData({ [key]: value });
  },

  /** 费用行金额输入 */
  onCostAmountInput(e) {
    const index = e.currentTarget.dataset.index;
    const value = Number(e.detail.value) || 0;
    const key = `costRows[${index}].amount`;
    this.setData({ [key]: value });
  },

  /** 维保行输入 */
  onMaintenanceInput(e) {
    const field = e.currentTarget.dataset.field;
    const value = Number(e.detail.value) || 0;
    const key = `maintenanceRow.${field}`;
    this.setData({ [key]: value });
  },

  // ============================================================
  // 操作按钮
  // ============================================================

  /** 保存草稿 */
  handleDraftSave() {
    this.setData({ saving: true });
    this.callDraftSave()
      .then(() => {
        wx.showToast({ title: '草稿已保存', icon: 'success' });
      })
      .catch((err) => {
        wx.showToast({ title: err.message || '保存失败', icon: 'none' });
      })
      .finally(() => {
        this.setData({ saving: false });
      });
  },

  /** 提交预览 */
  handlePreview() {
    this.setData({ saving: true });

    const { packageId, monthNo, contractRows, costRows, maintenanceRow } = this.data;
    const body = {
      monthNo,
      contractRows: contractRows.map((r) => ({
        contractId: r.contractId,
        completionAmount: toNumber(r.completionAmount),
        acceptanceAmount: toNumber(r.acceptanceAmount),
      })),
      costRows: costRows.map((r) => ({
        costCategoryCode: r.costCategoryCode,
        amount: toNumber(r.amount),
      })),
    };

    if (maintenanceRow && this.data.enableMaintenance) {
      body.maintenanceRow = maintenanceRow;
    }

    request({
      url: `/city/packages/${packageId}/submit-preview`,
      method: 'POST',
      data: body,
    })
      .then((data) => {
        this.setData({ showPreview: true, previewData: data, saving: false });
      })
      .catch((err) => {
        wx.showToast({ title: err.message || '预览失败', icon: 'none' });
        this.setData({ saving: false });
      });
  },

  /** 确认提交 */
  handleConfirmSubmit() {
    this.setData({ submitting: true });

    this.callSubmit()
      .then(() => {
        wx.showToast({ title: '提交成功', icon: 'success' });
        setTimeout(() => {
          wx.navigateBack();
        }, 1500);
      })
      .catch((err) => {
        wx.showToast({ title: err.message || '提交失败', icon: 'none' });
      })
      .finally(() => {
        this.setData({ submitting: false });
      });
  },

  /** 返回首页 */
  goBack() {
    wx.navigateBack();
  },

  /** 关闭预览 */
  handleClosePreview() {
    this.setData({ showPreview: false, previewData: null });
  },

  // ============================================================
  // 内部 API 调用
  // ============================================================

  callDraftSave() {
    const { packageId, monthNo, contractRows, costRows, maintenanceRow, enableMaintenance } = this.data;
    const body = {
      monthNo,
      contractRows: contractRows.map((r) => ({
        contractId: r.contractId,
        completionAmount: toNumber(r.completionAmount),
        acceptanceAmount: toNumber(r.acceptanceAmount),
      })),
      costRows: costRows.map((r) => ({
        costCategoryCode: r.costCategoryCode,
        amount: toNumber(r.amount),
      })),
    };

    if (maintenanceRow && enableMaintenance) {
      body.maintenanceRow = maintenanceRow;
    }

    return request({
      url: `/city/packages/${packageId}/draft-save`,
      method: 'POST',
      data: body,
    });
  },

  callSubmit() {
    const { packageId, monthNo, contractRows, costRows, maintenanceRow, enableMaintenance } = this.data;
    const body = {
      monthNo,
      contractRows: contractRows.map((r) => ({
        contractId: r.contractId,
        completionAmount: toNumber(r.completionAmount),
        acceptanceAmount: toNumber(r.acceptanceAmount),
      })),
      costRows: costRows.map((r) => ({
        costCategoryCode: r.costCategoryCode,
        amount: toNumber(r.amount),
      })),
    };

    if (maintenanceRow && enableMaintenance) {
      body.maintenanceRow = maintenanceRow;
    }

    return request({
      url: `/city/packages/${packageId}/submit`,
      method: 'POST',
      data: body,
    });
  },
});
