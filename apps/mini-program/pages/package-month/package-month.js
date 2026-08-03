const { request } = require('../../utils/request');

const COST_LABELS = {
  labor: '\u4eba\u5de5\u6210\u672c',
  utilities: '\u6c34\u7535\u8d39',
  fuel: '\u6cb9\u8865',
  entertainment: '\u62db\u5f85\u8d39',
  rent: '\u623f\u79df',
  reimbursement: '\u62a5\u9500',
  other: '\u5176\u4ed6',
};

const COST_CATEGORY_CODES = Object.keys(COST_LABELS);

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeAmountInput(value) {
  const raw = String(value || '');
  const cleaned = raw.replace(/[^\d.]/g, '');
  const parts = cleaned.split('.');
  if (parts.length <= 1) {
    return cleaned;
  }
  return `${parts[0]}.${parts.slice(1).join('')}`;
}

Page({
  data: {
    packageId: 0,
    monthNo: 0,
    year: new Date().getFullYear(),
    enableMaintenance: false,
    loading: true,
    isReadOnly: false,
    lockReason: '',
    pkgStatus: 'draft',
    contractRows: [],
    costRows: [],
    maintenanceRow: null,
    showPreview: false,
    previewData: null,
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

  loadMonthData() {
    const { packageId, monthNo } = this.data;
    const url = `/city/packages/${packageId}/months/${monthNo}`;

    request({ url })
      .then((data) => {
        const isReadOnly = Boolean(data.isLocked);
        this.setData({ loading: false, isReadOnly, lockReason: data.lockReason || '' });
        const src = data;

        if (src.contractRows && src.contractRows.length > 0) {
          const normalized = src.contractRows.map((r) => ({
            ...r,
            completionAmount: toNumber(r.completionAmount),
            acceptanceAmount: toNumber(r.acceptanceAmount),
            invoiceAmount: toNumber(r.invoiceAmount),
            orderAmount: toNumber(r.orderAmount),
          }));
          this.setData({ contractRows: normalized });
        }

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
        this.setData({ loading: false, isReadOnly: false });
        this.initCostRows();
        if (this.data.enableMaintenance) {
          this.setData({ maintenanceRow: { invoiceTotalPrevYear: 0, invoiceMonthCountPrevYear: 0, invoiceTotalCurrentYear: 0 } });
        }
      });
  },

  initCostRows() {
    const costRows = COST_CATEGORY_CODES.map((code) => ({
      costCategoryCode: code,
      amount: 0,
      costCategoryLabel: COST_LABELS[code] || code,
    }));
    this.setData({ costRows });
  },

  onContractCompletionInput(e) {
    const index = e.currentTarget.dataset.index;
    const value = normalizeAmountInput(e.detail.value);
    const key = `contractRows[${index}].completionAmount`;
    this.setData({ [key]: value });
  },

  onContractAcceptanceInput(e) {
    const index = e.currentTarget.dataset.index;
    const value = normalizeAmountInput(e.detail.value);
    const key = `contractRows[${index}].acceptanceAmount`;
    this.setData({ [key]: value });
  },

  onContractInvoiceInput(e) {
    const index = e.currentTarget.dataset.index;
    const value = normalizeAmountInput(e.detail.value);
    const key = `contractRows[${index}].invoiceAmount`;
    this.setData({ [key]: value });
  },

  onContractOrderInput(e) {
    const index = e.currentTarget.dataset.index;
    const value = normalizeAmountInput(e.detail.value);
    const key = `contractRows[${index}].orderAmount`;
    this.setData({ [key]: value });
  },

  onCostAmountInput(e) {
    const index = e.currentTarget.dataset.index;
    const value = normalizeAmountInput(e.detail.value);
    const key = `costRows[${index}].amount`;
    this.setData({ [key]: value });
  },

  onMaintenanceInput(e) {
    const field = e.currentTarget.dataset.field;
    const value = normalizeAmountInput(e.detail.value);
    const key = `maintenanceRow.${field}`;
    this.setData({ [key]: value });
  },

  handleDraftSave() {
    this.setData({ saving: true });
    this.callDraftSave()
      .then(() => {
        wx.showToast({ title: '\u8349\u7a3f\u5df2\u4fdd\u5b58', icon: 'success' });
      })
      .catch((err) => {
        wx.showToast({ title: err.message || '\u4fdd\u5b58\u5931\u8d25', icon: 'none' });
      })
      .finally(() => {
        this.setData({ saving: false });
      });
  },

  handlePreview() {
    this.setData({ saving: true });

    const { packageId, monthNo, contractRows, costRows, maintenanceRow } = this.data;
    const body = {
      monthNo,
      contractRows: contractRows.map((r) => ({
        contractId: r.contractId,
        completionAmount: toNumber(r.completionAmount),
        acceptanceAmount: toNumber(r.acceptanceAmount),
        invoiceAmount: toNumber(r.invoiceAmount),
        orderAmount: toNumber(r.orderAmount),
      })),
      costRows: costRows.map((r) => ({
        costCategoryCode: r.costCategoryCode,
        amount: toNumber(r.amount),
      })),
    };

    if (maintenanceRow && this.data.enableMaintenance) {
      body.maintenanceRow = {
        invoiceTotalPrevYear: toNumber(maintenanceRow.invoiceTotalPrevYear),
        invoiceMonthCountPrevYear: toNumber(maintenanceRow.invoiceMonthCountPrevYear),
        invoiceTotalCurrentYear: toNumber(maintenanceRow.invoiceTotalCurrentYear),
      };
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
        wx.showToast({ title: err.message || '\u9884\u89c8\u5931\u8d25', icon: 'none' });
        this.setData({ saving: false });
      });
  },

  handleConfirmSubmit() {
    this.setData({ submitting: true });

    this.callSubmit()
      .then(() => {
        wx.showToast({ title: '\u63d0\u4ea4\u6210\u529f', icon: 'success' });
        setTimeout(() => {
          wx.navigateBack();
        }, 1500);
      })
      .catch((err) => {
        wx.showToast({ title: err.message || '\u63d0\u4ea4\u5931\u8d25', icon: 'none' });
      })
      .finally(() => {
        this.setData({ submitting: false });
      });
  },

  goBack() {
    wx.navigateBack();
  },

  handleClosePreview() {
    this.setData({ showPreview: false, previewData: null });
  },

  callDraftSave() {
    const { packageId, monthNo, contractRows, costRows, maintenanceRow, enableMaintenance } = this.data;
    const body = {
      monthNo,
      contractRows: contractRows.map((r) => ({
        contractId: r.contractId,
        completionAmount: toNumber(r.completionAmount),
        acceptanceAmount: toNumber(r.acceptanceAmount),
        invoiceAmount: toNumber(r.invoiceAmount),
        orderAmount: toNumber(r.orderAmount),
      })),
      costRows: costRows.map((r) => ({
        costCategoryCode: r.costCategoryCode,
        amount: toNumber(r.amount),
      })),
    };

    if (maintenanceRow && enableMaintenance) {
      body.maintenanceRow = {
        invoiceTotalPrevYear: toNumber(maintenanceRow.invoiceTotalPrevYear),
        invoiceMonthCountPrevYear: toNumber(maintenanceRow.invoiceMonthCountPrevYear),
        invoiceTotalCurrentYear: toNumber(maintenanceRow.invoiceTotalCurrentYear),
      };
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
        invoiceAmount: toNumber(r.invoiceAmount),
        orderAmount: toNumber(r.orderAmount),
      })),
      costRows: costRows.map((r) => ({
        costCategoryCode: r.costCategoryCode,
        amount: toNumber(r.amount),
      })),
    };

    if (maintenanceRow && enableMaintenance) {
      body.maintenanceRow = {
        invoiceTotalPrevYear: toNumber(maintenanceRow.invoiceTotalPrevYear),
        invoiceMonthCountPrevYear: toNumber(maintenanceRow.invoiceMonthCountPrevYear),
        invoiceTotalCurrentYear: toNumber(maintenanceRow.invoiceTotalCurrentYear),
      };
    }

    return request({
      url: `/city/packages/${packageId}/submit`,
      method: 'POST',
      data: body,
    });
  },
});