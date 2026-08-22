import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBizPermission } from '@/utils/biz-permission';
import {
  Alert, Badge, Button, Card, Descriptions, Drawer, Form, Input, InputNumber, Modal, Progress, Select, Space, Table, Tabs, Tag, Typography, Upload, message,
} from 'antd';
import { DeleteOutlined, DownloadOutlined, EditOutlined, ExportOutlined, PlusOutlined, ReloadOutlined, UndoOutlined, UploadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import * as XLSX from 'xlsx';
import {
  bizAdminProvinces, bizAdminCities,
  bizContractList, bizContractCreate, bizContractDetail, bizContractUpdate,
  bizContractActivate, bizContractBatchActivate, bizContractBatchClearDrafts, bizContractVoid, bizContractUpsertAllocation,
  bizContractCancelAllocation, bizContractAddFeeRate,
  bizContractUpload, bizContractDelete, bizContractBatchDelete, bizContractBatchUpdate, bizContractBatchRestore, bizContractRestore, bizContractExport,
  type BizContractDetail, type BizContractItem,
} from '@/api/biz.api';

const { Title, Text } = Typography;

const STATUS_LABEL: Record<string, string> = {
  draft: '草稿', active: '执行中', completed: '已完成', voided: '已作废',
};
const STATUS_COLOR: Record<string, string> = {
  draft: 'default', active: 'blue', completed: 'green', voided: 'red',
};
const ALERT_LABEL: Record<string, string> = {
  nearly_full: '接近满额', overfull: '满额/超额', expiring: '即将到期', expired: '已到期', pending_complete: '待完成确认',
};

/** 统一提取后端错误消息 */
function errorText(e: unknown, fallback: string): string {
  const detail = (e as { response?: { data?: { message?: string | string[] } } }).response?.data?.message;
  return Array.isArray(detail) ? detail.join('；') : (detail ?? fallback);
}

function fenToYuan(fen: number): string {
  return (fen / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatYearMonth(value: string | null | undefined): string {
  if (!value) return '-';
  return dayjs(value).isValid() ? dayjs(value).format('YYYY年MM月') : value;
}

/** 合同管理（新基线 M3）：列表 + 全屏详情弹窗 */
export default function BizContracts() {
  const navigate = useNavigate();
  const canUploadOrder = useBizPermission('operation.order.upload');
  const canCreateContract = useBizPermission('operation.contract.create');
  const canUpdateContract = useBizPermission('operation.contract.update');
  const canDeleteContract = useBizPermission('operation.contract.delete');
  const canBatchCreate = useBizPermission('operation.contract.batch_create');
  const canBatchUpdate = useBizPermission('operation.contract.batch_update');
  const canBatchDelete = useBizPermission('operation.contract.batch_delete');
  const canRestoreContract = useBizPermission('operation.contract.restore');
  const canExportContract = useBizPermission('operation.contract.export');
  const [items, setItems] = useState<BizContractItem[]>([]);
  const [provinces, setProvinces] = useState<Array<{ id: string; name: string }>>([]);
  const [cities, setCities] = useState<Array<{ id: string; name: string; provinceId: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [keyword, setKeyword] = useState('');
  const [appliedKeyword, setAppliedKeyword] = useState('');
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [pagination, setPagination] = useState({ current: 1, pageSize: 10 });
  const [batchRunning, setBatchRunning] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [detail, setDetail] = useState<BizContractDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [createForm] = Form.useForm();
  const [allocForm] = Form.useForm();
  const [rateForm] = Form.useForm();
  const [editForm] = Form.useForm();
  const [editOpen, setEditOpen] = useState(false);
  const [editBatch, setEditBatch] = useState(false);
  const [editTarget, setEditTarget] = useState<BizContractItem | null>(null);
  const [batchDetail, setBatchDetail] = useState<{ title: string; checked: number; doneLabel: string; done: string[]; skipped: Array<{ id: string; contractNo?: string; reason: string }> } | null>(null);
  const [batchDetailOpen, setBatchDetailOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, p, c] = await Promise.all([
        bizContractList({ ...(statusFilter ? { status: statusFilter } : {}), ...(appliedKeyword ? { keyword: appliedKeyword } : {}), includeDeleted }),
        bizAdminProvinces().catch(() => ({ items: [] })),
        bizAdminCities().catch(() => ({ items: [] })),
      ]);
      setItems((list.items ?? []).map((item) => ({
        ...item,
        tags: Array.isArray(item.tags) ? item.tags : [],
      })));
      setPagination((value) => ({ ...value, current: 1 }));
      setProvinces((p.items ?? []).map((x) => ({ id: String(x.id), name: String(x.name) })));
      setCities((c.items ?? []).map((x) => ({ id: String(x.id), name: String(x.name), provinceId: String(x.provinceId) })));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, appliedKeyword, includeDeleted]);

  useEffect(() => { void load(); }, [load]);

  // 跨分页保留选中：仅剔除列表已不存在的行（含删除后消失），不再按 draft 限制
  useEffect(() => { setSelectedRowKeys((keys) => keys.filter((key) => items.some((item) => item.id === key))); }, [items]);

  const openDetail = async (id: string) => {
    setDetailOpen(true);
    setDetailLoading(true);
    try {
      const d = await bizContractDetail(id);
      setDetail({
        ...d,
        allocations: Array.isArray(d.allocations) ? d.allocations : [],
        feeRates: Array.isArray(d.feeRates) ? d.feeRates : [],
        activationIssues: Array.isArray(d.activationIssues) ? d.activationIssues : [],
        alerts: Array.isArray(d.alerts) ? d.alerts : [],
      });
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { message?: string } } }).response?.data?.message;
      message.error(detail ?? '加载失败');
    } finally {
      setDetailLoading(false);
    }
  };

  const onCreate = async (values: Record<string, unknown>) => {
    try {
      await bizContractCreate({
        contractNo: String(values.contractNo),
        contractName: String(values.contractName),
        taxInclusiveAmountFen: Math.round(Number(values.taxInclusiveAmountFen) * 100),
        provinceId: String(values.provinceId),
        startDate: values.startDate ? dayjs(String(values.startDate)).format('YYYY-MM-DD') : null,
        endDate: values.endDate ? dayjs(String(values.endDate)).format('YYYY-MM-DD') : null,
      });
      message.success('合同草稿已创建');
      setCreateOpen(false);
      createForm.resetFields();
      void load();
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { message?: string | string[] } } }).response?.data?.message;
      message.error(Array.isArray(detail) ? detail.join('；') : (detail ?? '创建失败'));
    }
  };

  const downloadTemplate = () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ['省份名称', '地市名称', '合同编号', '合同名称', '合同含税金额', '合同期限', '管理费比例'],
      ['山东省', '济南市公司', '示例-2026-001', '示例维护合同', 100000, '2026.01.01-2026.12.31', 0.1],
    ]);
    sheet['!cols'] = [14, 16, 20, 36, 18, 24, 16].map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(workbook, sheet, '合同导入');
    XLSX.writeFile(workbook, '合同导入模板.xlsx');
  };

  const onImport = async (file: File) => {
    setImporting(true);
    try {
      const result = await bizContractUpload(file);
      message.success(`已导入 ${result.created} 份合同，并生成 ${result.allocations ?? 0} 条地市分配和 ${result.feeRates ?? 0} 条费率`);
      if (result.issues?.length) {
        Modal.warning({
          title: `导入完成，${result.issues.length} 项待管理员维护`,
          width: 760,
          content: <div style={{ maxHeight: 420, overflow: 'auto', marginTop: 12 }}>{result.issues.map((issue, index) => <p key={`${index}-${issue}`}>{issue}</p>)}</div>,
        });
      }
      setImportOpen(false);
      void load();
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { message?: string | string[] } } }).response?.data?.message;
      message.error(Array.isArray(detail) ? detail.join('；') : (detail ?? '合同导入失败'));
    } finally {
      setImporting(false);
    }
    return false;
  };

  const onActivate = async (id: string) => {
    try {
      await bizContractActivate(id);
      message.success('合同已生效（合同额锁定）');
      if (detail?.contract.id === id) await openDetail(id);
      void load();
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { message?: string } } }).response?.data?.message;
      message.error(detail ?? '生效失败');
    }
  };

  const showBatchResult = (title: string, result: { checked: number; activated: string[]; failed: Array<{ contractNo?: string; reason: string }> }) => {
    Modal.info({
      title,
      width: 680,
      content: <div style={{ marginTop: 12 }}>
        <p>已检查 {result.checked} 份合同；可生效/已生效 {result.activated.length} 份；存在问题 {result.failed.length} 份。</p>
        {result.failed.length > 0 && <Table size="small" rowKey={(row) => `${row.contractNo}-${row.reason}`} pagination={false} dataSource={result.failed} columns={[
          { title: '合同编号', dataIndex: 'contractNo', key: 'contractNo', render: (value: string | undefined) => value ?? '-' },
          { title: '未生效原因', dataIndex: 'reason', key: 'reason' },
        ]} />}
      </div>,
    });
  };

  const runBatch = async (dryRun: boolean) => {
    const ids = selectedRowKeys.map(String);
    if (!ids.length) { message.warning('请选择要处理的草稿合同'); return; }
    setBatchRunning(true);
    try {
      const result = await bizContractBatchActivate(ids, dryRun);
      showBatchResult(dryRun ? '批量校验结果' : '批量生效结果', result);
      if (!dryRun) { setSelectedRowKeys([]); await load(); }
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { message?: string | string[] } } }).response?.data?.message;
      message.error(Array.isArray(detail) ? detail.join('；') : (detail ?? '批量处理失败'));
    } finally { setBatchRunning(false); }
  };

  const onBatchActivate = () => Modal.confirm({
    title: '批量生效合同',
    content: `将逐一校验并生效已选的 ${selectedRowKeys.length} 份草稿合同；资料不完整的合同将保持草稿，不影响其余合同。`,
    okText: '确认批量生效',
    onOk: () => runBatch(false),
  });

  const onBatchClear = () => Modal.confirm({
    title: '批量清空错误草稿',
    content: `将永久清空已选的 ${selectedRowKeys.length} 份草稿合同及其地市分配、管理费率和预警。已生效合同或已有订单、线下完工的合同不会清空。此操作不可恢复。`,
    okText: '确认永久清空',
    okButtonProps: { danger: true },
    onOk: async () => {
      setBatchRunning(true);
      try {
        const result = await bizContractBatchClearDrafts(selectedRowKeys.map(String));
        message.success(`已清空 ${result.cleared} 份草稿合同`);
        if (result.skipped.length) Modal.warning({ title: '部分合同未清空', content: result.skipped.map((item) => `${item.contractNo ?? item.id}：${item.reason}`).join('；') });
        setSelectedRowKeys([]);
        await load();
      } catch (e: unknown) {
        const detail = (e as { response?: { data?: { message?: string | string[] } } }).response?.data?.message;
        message.error(Array.isArray(detail) ? detail.join('；') : (detail ?? '批量清空失败'));
      } finally { setBatchRunning(false); }
    },
  });

  /** 批量结果明细弹窗（删除/恢复/编辑通用：返回成功/失败数量 + 每条失败原因） */
  const showBatchDetail = (title: string, checked: number, doneLabel: string, done: string[], skipped: Array<{ id: string; contractNo?: string; reason: string }>) => {
    setBatchDetail({ title, checked, doneLabel, done, skipped });
    setBatchDetailOpen(true);
  };

  const onDelete = (row: BizContractItem) => Modal.confirm({
    title: '删除合同',
    content: `将软删除合同「${row.contractNo}」（保留记录与恢复入口）。确定删除？`,
    okText: '确认删除',
    okButtonProps: { danger: true },
    onOk: async () => {
      try {
        await bizContractDelete(row.id);
        message.success('合同已删除');
        if (detail?.contract.id === row.id) setDetailOpen(false);
        setSelectedRowKeys((keys) => keys.filter((k) => k !== row.id));
        await load();
      } catch (e) { message.error(errorText(e, '删除失败')); }
    },
  });

  const onRestore = async (id: string) => {
    try {
      await bizContractRestore(id);
      message.success('合同已恢复');
      if (detail?.contract.id === id) await openDetail(id);
      await load();
    } catch (e) { message.error(errorText(e, '恢复失败')); }
  };

  const onBatchDelete = () => Modal.confirm({
    title: '批量删除合同',
    content: `将软删除已选的 ${selectedRowKeys.length} 份合同（保留记录与恢复入口）。确定执行？`,
    okText: '确认删除',
    okButtonProps: { danger: true },
    onOk: async () => {
      setBatchRunning(true);
      try {
        const result = await bizContractBatchDelete(selectedRowKeys.map(String));
        showBatchDetail('批量删除结果', result.checked, '已删除', result.deleted, result.skipped);
        setSelectedRowKeys([]);
        await load();
      } catch (e) { message.error(errorText(e, '批量删除失败')); } finally { setBatchRunning(false); }
    },
  });

  const onBatchRestore = () => Modal.confirm({
    title: '批量恢复合同',
    content: `将恢复已选的 ${selectedRowKeys.length} 份已删除合同。确定执行？`,
    okText: '确认恢复',
    onOk: async () => {
      setBatchRunning(true);
      try {
        const result = await bizContractBatchRestore(selectedRowKeys.map(String));
        showBatchDetail('批量恢复结果', result.checked, '已恢复', result.restored, result.skipped);
        setSelectedRowKeys([]);
        await load();
      } catch (e) { message.error(errorText(e, '批量恢复失败')); } finally { setBatchRunning(false); }
    },
  });

  const openEdit = (row: BizContractItem) => {
    setEditTarget(row);
    setEditBatch(false);
    editForm.setFieldsValue({
      contractName: row.contractName,
      startDate: row.startDate ?? '',
      endDate: row.endDate ?? '',
      taxInclusiveAmountFen: (Number(row.taxInclusiveAmountFen) || 0) / 100,
    });
    setEditOpen(true);
  };

  const openBatchEdit = () => {
    setEditTarget(null);
    setEditBatch(true);
    editForm.resetFields();
    setEditOpen(true);
  };

  const onEditSubmit = async (values: Record<string, unknown>) => {
    const dto: Record<string, unknown> = {};
    if (values.contractName !== undefined && String(values.contractName).trim()) dto.contractName = String(values.contractName).trim();
    if (values.startDate !== undefined) dto.startDate = values.startDate ? dayjs(String(values.startDate)).format('YYYY-MM-DD') : null;
    if (values.endDate !== undefined) dto.endDate = values.endDate ? dayjs(String(values.endDate)).format('YYYY-MM-DD') : null;
    if (values.taxInclusiveAmountFen !== undefined && values.taxInclusiveAmountFen !== null && String(values.taxInclusiveAmountFen) !== '') dto.taxInclusiveAmountFen = Math.round(Number(values.taxInclusiveAmountFen) * 100);
    try {
      if (editTarget) {
        await bizContractUpdate(editTarget.id, dto);
        message.success('合同已更新');
        if (detail?.contract.id === editTarget.id) await openDetail(editTarget.id);
        setEditOpen(false);
        await load();
      } else {
        const ids = selectedRowKeys.map(String);
        if (!ids.length) { message.warning('请先选择合同'); return; }
        setBatchRunning(true);
        try {
          const result = await bizContractBatchUpdate(ids, dto);
          showBatchDetail('批量编辑结果', result.checked, '已更新', result.updated, result.skipped);
          setEditOpen(false);
          setSelectedRowKeys([]);
          await load();
        } finally { setBatchRunning(false); }
      }
    } catch (e) { message.error(errorText(e, editTarget ? '保存失败' : '批量编辑失败')); }
  };

  const onBatchExport = async () => {
    const ids = selectedRowKeys.map(String);
    if (!ids.length) { message.warning('请先选择合同'); return; }
    setBatchRunning(true);
    try {
      const csv = await bizContractExport({ ids, ...(includeDeleted ? { includeDeleted: true } : {}) });
      const blob = new Blob([csv.startsWith('\uFEFF') ? csv : '\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `合同导出-选中${ids.length}份.csv`;
      a.click(); URL.revokeObjectURL(url);
      message.success(`已导出 ${ids.length} 份合同`);
    } catch (e) { message.error(errorText(e, '导出失败')); } finally { setBatchRunning(false); }
  };

  const onVoid = (id: string) => {
    Modal.confirm({
      title: '作废合同',
      content: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
          <Select
            placeholder="汇总口径（必选）" options={[
              { value: 'exclude_current', label: '从当前汇总剔除' },
              { value: 'retain_history', label: '保留历史汇总' },
            ]}
            id="void-choice" style={{ width: '100%' }}
          />
          <Input placeholder="作废原因（必填）" id="void-reason" />
        </div>
      ),
      okText: '确认作废',
      onOk: async () => {
        const choice = (document.getElementById('void-choice') as HTMLSelectElement)?.value;
        const reason = (document.getElementById('void-reason') as HTMLInputElement)?.value;
        if (!choice || !reason?.trim()) { message.warning('请选择汇总口径并填写原因'); return Promise.reject(); }
        await bizContractVoid(id, choice, reason);
        message.success('合同已作废');
        if (detail?.contract.id === id) setDetailOpen(false);
        void load();
      },
    });
  };

  const onUpsertAllocation = async (id: string) => {
    const values = await allocForm.validateFields();
    try {
      await bizContractUpsertAllocation(id, String(values.cityId), Math.round(Number(values.quotaFen) * 100));
      message.success('地市分配已保存');
      allocForm.resetFields();
      await openDetail(id);
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { message?: string } } }).response?.data?.message;
      message.error(detail ?? '分配失败');
    }
  };

  const onCancelAllocation = async (id: string, cityId: string) => {
    Modal.confirm({
      title: '取消地市分配',
      content: '取消后该地市历史数据保留，禁止新增业务（仅 super_admin 可操作）。',
      okText: '确认取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        await bizContractCancelAllocation(id, cityId);
        message.success('已取消分配');
        await openDetail(id);
      },
    });
  };

  const onAddFeeRate = async (id: string) => {
    const values = await rateForm.validateFields();
    try {
      await bizContractAddFeeRate(id, String(values.cityId), String(values.effectiveMonth), Math.round(Number(values.rateBp) * 100), String(values.changeReason ?? ''));
      message.success('费率已保存');
      rateForm.resetFields();
      await openDetail(id);
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { message?: string } } }).response?.data?.message;
      message.error(detail ?? '费率保存失败');
    }
  };

  const columns = [
    { title: '合同编号', dataIndex: 'contractNo', key: 'contractNo', render: (v: string, row: BizContractItem) => <a data-testid={`contract-detail-${v}`} onClick={() => openDetail(row.id)}>{v}</a> },
    { title: '合同名称', dataIndex: 'contractName', key: 'contractName', ellipsis: true },
    { title: '含税合同额（元）', dataIndex: 'taxInclusiveAmountFen', key: 'amount', render: (v: number) => fenToYuan(Number(v)) },
    {
      title: '状态', dataIndex: 'status', key: 'status',
      render: (v: string, row: BizContractItem) => (
        <Space size={4}>
          {row.deletedAt && <Tag color="red">已删除</Tag>}
          <Tag color={STATUS_COLOR[v]}>{STATUS_LABEL[v] ?? v}</Tag>
        </Space>
      ),
    },
    {
      title: '预警', dataIndex: 'tags', key: 'tags',
      render: (tags?: string[] | string | null) => (Array.isArray(tags) ? tags : []).map((t) => <Tag key={t} color="orange">{ALERT_LABEL[t] ?? t}</Tag>),
    },
    {
      title: '操作', key: 'action', width: 280,
      render: (_: unknown, row: BizContractItem) => {
        const isDeleted = Boolean(row.deletedAt);
        return (
          <Space wrap>
            <Button size="small" onClick={() => openDetail(row.id)}>详情</Button>
            {!isDeleted && canUpdateContract === true && <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(row)}>编辑</Button>}
            {!isDeleted && row.status === 'draft' && <Button size="small" type="primary" onClick={() => onActivate(row.id)}>生效</Button>}
            {!isDeleted && ['active', 'completed'].includes(row.status) && <Button size="small" danger onClick={() => onVoid(row.id)}>作废</Button>}
            {!isDeleted && canDeleteContract === true && <Button size="small" danger icon={<DeleteOutlined />} onClick={() => onDelete(row)}>删除</Button>}
            {isDeleted && canRestoreContract === true && <Button size="small" icon={<UndoOutlined />} onClick={() => onRestore(row.id)}>恢复</Button>}
          </Space>
        );
      },
    },
  ];

  return (
    <div className="v3-content">
      <div className="v3-page-head">
        <div className="v3-page-titles">
          <Title level={4} style={{ margin: 0 }}>合同管理</Title>
        </div>
        <Space className="v3-page-head-actions" wrap>
          {canUploadOrder === true && <Button onClick={() => navigate('/biz/orders')}>订单管理</Button>}
          {canCreateContract === true && <Button icon={<DownloadOutlined />} onClick={downloadTemplate}>下载模板</Button>}
          {(canCreateContract === true || canBatchCreate === true) && <Button icon={<UploadOutlined />} onClick={() => setImportOpen(true)}>导入合同</Button>}
          {canUpdateContract === true && <Button disabled={!selectedRowKeys.length} loading={batchRunning} onClick={() => void runBatch(true)}>批量校验</Button>}
          {canUpdateContract === true && <Button type="primary" disabled={!selectedRowKeys.length} loading={batchRunning} onClick={onBatchActivate}>批量生效</Button>}
          {canUpdateContract === true && <Button danger icon={<DeleteOutlined />} disabled={!selectedRowKeys.length} loading={batchRunning} onClick={onBatchClear}>批量清空</Button>}
          {canBatchUpdate === true && <Button icon={<EditOutlined />} disabled={!selectedRowKeys.length} loading={batchRunning} onClick={openBatchEdit}>批量编辑</Button>}
          {canBatchDelete === true && <Button danger icon={<DeleteOutlined />} disabled={!selectedRowKeys.length} loading={batchRunning} onClick={onBatchDelete}>批量删除</Button>}
          {canRestoreContract === true && <Button icon={<UndoOutlined />} disabled={!selectedRowKeys.length} loading={batchRunning} onClick={onBatchRestore}>批量恢复</Button>}
          {canExportContract === true && <Button icon={<ExportOutlined />} disabled={!selectedRowKeys.length} loading={batchRunning} onClick={onBatchExport}>导出选中</Button>}
          <Button type={includeDeleted ? 'primary' : 'default'} onClick={() => setIncludeDeleted((v) => !v)}>显示已删除</Button>
          <Input.Search
            allowClear
            placeholder="搜索合同编号或名称"
            style={{ width: 220 }}
            value={keyword}
            onChange={(event) => {
              const value = event.target.value;
              setKeyword(value);
              if (!value) setAppliedKeyword('');
            }}
            onSearch={(value) => setAppliedKeyword(value.trim())}
          />
          <Select
            allowClear placeholder="状态筛选" style={{ width: 140 }} value={statusFilter}
            onChange={(v) => setStatusFilter(v)}
            options={Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }))}
          />
          <Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>新建合同</Button>
        </Space>
      </div>
      <Card>
        <Table scroll={{ x: "max-content" }} rowKey="id" loading={loading} columns={columns} dataSource={items} pagination={{
          current: pagination.current,
          pageSize: pagination.pageSize,
          total: items.length,
          showSizeChanger: true,
          pageSizeOptions: ['10', '20', '50', '100'],
          onChange: (current, pageSize) => setPagination({ current, pageSize }),
          showTotal: (total, range) => `${range[0]}-${range[1]} / 共 ${total} 条`,
        }} rowSelection={canUpdateContract === true || canBatchUpdate === true || canBatchDelete === true || canRestoreContract === true || canExportContract === true ? {
          selectedRowKeys,
          onChange: setSelectedRowKeys,
          preserveSelectedRowKeys: true,
          selections: [Table.SELECTION_ALL, Table.SELECTION_INVERT, Table.SELECTION_NONE],
        } : undefined} />
      </Card>

      {/* 新建合同 */}
      <Drawer title="新建合同（草稿）" open={createOpen} onClose={() => setCreateOpen(false)} width={420}>
        <Form form={createForm} layout="vertical" onFinish={onCreate}>
          <Form.Item name="contractNo" label="合同编号" rules={[{ required: true, message: '真实合同号，全局唯一' }]}><Input /></Form.Item>
          <Form.Item name="contractName" label="合同名称" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="taxInclusiveAmountFen" label="含税合同金额（元）" rules={[{ required: true, message: '草稿可暂填，生效前须>0' }]}>
            <InputNumber min={0} precision={2} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="provinceId" label="所属省份" rules={[{ required: true }]}>
            <Select options={provinces.map((p) => ({ value: p.id, label: p.name }))} />
          </Form.Item>
          <Form.Item name="startDate" label="开始日期"><Input type="date" /></Form.Item>
          <Form.Item name="endDate" label="结束日期"><Input type="date" /></Form.Item>
          <Button type="primary" htmlType="submit" block>保存草稿</Button>
        </Form>
      </Drawer>

      <Modal title="Excel 合同导入" open={importOpen} footer={null} onCancel={() => !importing && setImportOpen(false)}>
        <Upload.Dragger
          accept=".xlsx"
          beforeUpload={onImport}
          disabled={importing}
          maxCount={1}
          showUploadList={false}
        >
          <p className="ant-upload-drag-icon"><UploadOutlined /></p>
          <p className="ant-upload-text">点击或拖拽合同 .xlsx 文件到此处</p>
          <p className="ant-upload-hint">识别合同编号、地市分配额和管理费率；同一合同的多地市行会合并为一份合同，并自动生成地市分配和费率记录。</p>
        </Upload.Dragger>
        {importing && <Progress percent={65} status="active" style={{ marginTop: 16 }} />}
      </Modal>

      {/* 编辑/批量编辑合同 */}
      <Modal
        title={editBatch ? `批量编辑（已选 ${selectedRowKeys.length} 份合同）` : `编辑合同 ${editTarget?.contractNo ?? ''}`}
        open={editOpen}
        onCancel={() => setEditOpen(false)}
        onOk={() => editForm.submit()}
        confirmLoading={batchRunning}
        width={460}
      >
        <Form form={editForm} layout="vertical" onFinish={onEditSubmit}>
          <Form.Item name="contractName" label="合同名称"><Input placeholder="留空则不修改" /></Form.Item>
          <Form.Item name="startDate" label="开始日期"><Input type="date" /></Form.Item>
          <Form.Item name="endDate" label="结束日期"><Input type="date" /></Form.Item>
          <Form.Item
            name="taxInclusiveAmountFen"
            label={`含税合同金额（元）${!editBatch && editTarget?.amountLocked ? '（已锁定）' : ''}`}
          >
            <InputNumber min={0} precision={2} style={{ width: '100%' }} disabled={!editBatch && Boolean(editTarget?.amountLocked)} />
          </Form.Item>
          {editBatch && <Alert type="info" showIcon message="仅填写需要修改的字段，未填写字段保持不变；合同额已锁定的合同不会被修改。" />}
        </Form>
      </Modal>

      {/* 批量操作结果（删除/恢复/编辑：成功/失败数量 + 每条失败原因） */}
      <Modal title={batchDetail?.title} open={batchDetailOpen} footer={null} onCancel={() => setBatchDetailOpen(false)} width={680}>
        {batchDetail && (
          <div style={{ marginTop: 12 }}>
            <p>已检查 {batchDetail.checked} 份合同；{batchDetail.doneLabel} {batchDetail.done.length} 份；跳过 {batchDetail.skipped.length} 份。</p>
            {batchDetail.skipped.length > 0 && <Table size="small" rowKey={(row) => `${row.id}-${row.contractNo ?? ''}-${row.reason}`} pagination={false} dataSource={batchDetail.skipped} columns={[
              { title: '合同编号', dataIndex: 'contractNo', key: 'contractNo', render: (value: string | undefined) => value ?? '-' },
              { title: '未处理原因', dataIndex: 'reason', key: 'reason' },
            ]} />}
          </div>
        )}
      </Modal>

      {/* 全屏详情 */}
      <Drawer
        title={detail ? `${detail.contract.contractName} / ${detail.contract.contractNo}` : '合同详情'}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        width="92%"
      >
        {detailLoading || !detail ? null : (
          <Tabs
            items={[
              {
                key: 'basic', label: '基本信息',
                children: (
                  <div>
                    <Descriptions bordered size="small" column={2}>
                      <Descriptions.Item label="状态"><Tag color={STATUS_COLOR[detail.contract.status]}>{STATUS_LABEL[detail.contract.status]}</Tag></Descriptions.Item>
                      <Descriptions.Item label="合同额锁定">{detail.contract.amountLocked ? '已锁定' : '未锁定'}</Descriptions.Item>
                      <Descriptions.Item label="含税合同额（元）">{fenToYuan(detail.contract.taxInclusiveAmountFen)}</Descriptions.Item>
                      <Descriptions.Item label="不含税（元）">{detail.contract.taxExclusiveAmountFen != null ? fenToYuan(detail.contract.taxExclusiveAmountFen) : '-'}</Descriptions.Item>
                      <Descriptions.Item label="开始日期"><span data-testid="contract-start-date">{formatYearMonth(detail.contract.startDate)}</span></Descriptions.Item>
                      <Descriptions.Item label="结束日期"><span data-testid="contract-end-date">{formatYearMonth(detail.contract.endDate)}</span></Descriptions.Item>
                      <Descriptions.Item label="父合同">{detail.contract.parentContractId ?? '-'}</Descriptions.Item>
                      <Descriptions.Item label="版本号">{detail.contract.versionNo}</Descriptions.Item>
                    </Descriptions>
                    <div style={{ marginTop: 16, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      {detail.contract.status === 'draft' && <Button type="primary" disabled={Boolean(detail.activationIssues?.length)} onClick={() => onActivate(detail.contract.id)}>生效并锁定合同额</Button>}
                      {['active', 'completed'].includes(detail.contract.status) && <Button danger onClick={() => onVoid(detail.contract.id)}>作废合同</Button>}
                    </div>
                    {detail.contract.status === 'draft' && Boolean(detail.activationIssues?.length) && (
                      <Alert type="warning" showIcon style={{ marginTop: 12 }} message="当前合同不能生效" description={`请先补齐：${detail.activationIssues?.join('、')}`} />
                    )}
                  </div>
                ),
              },
              {
                key: 'alloc', label: '地市分配与额度',
                children: (
                  <div>
                    <Form form={allocForm} layout="inline" style={{ marginBottom: 12 }}>
                      <Form.Item name="cityId" rules={[{ required: true }]}>
                        <Select placeholder="选择地市" style={{ width: 160 }} options={cities.map((c) => ({ value: c.id, label: c.name }))} />
                      </Form.Item>
                      <Form.Item name="quotaFen" rules={[{ required: true }]}>
                        <InputNumber placeholder="固定额度（元）" min={0} precision={2} style={{ width: 160 }} />
                      </Form.Item>
                      <Button type="primary" onClick={() => onUpsertAllocation(detail.contract.id)}>新增/调整</Button>
                    </Form>
                    <Table scroll={{ x: "max-content" }} 
                      size="small" rowKey="cityId" pagination={false} dataSource={detail.allocations}
                      columns={[
                        { title: '地市', dataIndex: 'cityName', key: 'cityName' },
                        { title: '固定额度（元）', dataIndex: 'quotaFen', key: 'quotaFen', render: (v: number) => fenToYuan(Number(v)) },
                        { title: '累计完工（元）', dataIndex: 'completionFen', key: 'completionFen', render: (v: number) => fenToYuan(Number(v)) },
                        { title: '地市进度', dataIndex: 'progress', key: 'progress', render: (v: number) => <Progress percent={Math.round(v)} size="small" /> },
                        { title: '地市超额（元）', dataIndex: 'overrunFen', key: 'overrunFen', render: (v: number) => Number(v) > 0 ? <Tag color="red">{fenToYuan(Number(v))}</Tag> : '-' },
                        { title: '状态', dataIndex: 'status', key: 'status', render: (v: string) => v === 'active' ? '有效' : <Tag color="red">已取消</Tag> },
                        {
                          title: '操作', key: 'op',
                          render: (_: unknown, row: { cityId: string }) => (
                            <Button size="small" danger onClick={() => onCancelAllocation(detail.contract.id, row.cityId)}>取消分配</Button>
                          ),
                        },
                      ]}
                    />
                  </div>
                ),
              },
              {
                key: 'rate', label: '费率记录',
                children: (
                  <div>
                    <Form form={rateForm} layout="inline" style={{ marginBottom: 12 }}>
                      <Form.Item name="cityId" rules={[{ required: true }]}>
                        <Select placeholder="地市" style={{ width: 140 }} options={cities.map((c) => ({ value: c.id, label: c.name }))} />
                      </Form.Item>
                      <Form.Item name="effectiveMonth" rules={[{ required: true }]}><Input placeholder="生效月份 YYYY-MM" style={{ width: 140 }} /></Form.Item>
                        <Form.Item name="rateBp" rules={[{ required: true }]}><InputNumber placeholder="费率（%）" min={0.01} max={100} precision={2} style={{ width: 110 }} /></Form.Item>
                      <Form.Item name="changeReason"><Input placeholder="变更原因" style={{ width: 180 }} /></Form.Item>
                      <Button type="primary" onClick={() => onAddFeeRate(detail.contract.id)}>保存费率</Button>
                    </Form>
                    <Table scroll={{ x: "max-content" }} 
                      size="small" rowKey={(r) => `${r.cityId}-${r.effectiveMonth}`} pagination={false} dataSource={detail.feeRates}
                      columns={[
                        { title: '地市', dataIndex: 'cityId', key: 'cityId', render: (v: string) => cities.find((c) => c.id === v)?.name ?? v },
                        { title: '生效月份', dataIndex: 'effectiveMonth', key: 'effectiveMonth' },
                        { title: '费率', dataIndex: 'rateBp', key: 'rateBp', render: (v: number) => `${(Number(v) / 100).toFixed(2)}%` },
                        { title: '变更原因', dataIndex: 'changeReason', key: 'changeReason' },
                      ]}
                    />
                  </div>
                ),
              },
              {
                key: 'progress', label: '完工进度',
                children: (
                  <div>
                    <Descriptions bordered size="small" column={3}>
                      <Descriptions.Item label="订单完工（元）">{fenToYuan(detail.progress.orderCompletionFen)}</Descriptions.Item>
                      <Descriptions.Item label="线下完工（元）">{fenToYuan(detail.progress.offlineCompletionFen)}</Descriptions.Item>
                      <Descriptions.Item label="累计完工（元）">{fenToYuan(detail.progress.totalCompletionFen)}</Descriptions.Item>
                      <Descriptions.Item label="合同进度">
                        <Progress percent={Math.round(detail.progress.progress)} status={detail.progress.progress >= 100 ? 'exception' : 'active'} />
                        {detail.progress.progressBasis !== 'contract' && (
                          <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                            {detail.progress.progressBasis === 'province-quota' ? '按省下辖市分配额度' : '按本地市分配额度'} {fenToYuan(detail.progress.quotaFen ?? 0)} 计算
                          </Text>
                        )}
                      </Descriptions.Item>
                      <Descriptions.Item label="剩余额度（元）">{fenToYuan(detail.progress.remainingFen)}</Descriptions.Item>
                      <Descriptions.Item label="合同超额（元）">
                        {detail.progress.overrunFen > 0 ? <Tag color="red">{fenToYuan(detail.progress.overrunFen)}</Tag> : '-'}
                      </Descriptions.Item>
                    </Descriptions>
                    {detail.finance && (
                      <Descriptions bordered size="small" column={3} style={{ marginTop: 12 }}>
                        <Descriptions.Item label="完工毛利（元）">{fenToYuan(detail.finance.grossProfitFen)}</Descriptions.Item>
                        <Descriptions.Item label="所分配地市成本参考（元）">{fenToYuan(detail.finance.referenceCostFen)}</Descriptions.Item>
                        <Descriptions.Item label="参考净利（元）">{fenToYuan(detail.finance.referenceNetProfitFen)}</Descriptions.Item>
                      </Descriptions>
                    )}
                    {detail.finance?.isReference && (
                      <Text type="secondary" style={{ display: 'block', marginTop: 6 }}>注：成本不关联合同，按所分配地市汇总为参考值；一地市分配多合同时会重复计入，不用于净利润口径。</Text>
                    )}
                    <div style={{ marginTop: 12 }}>
                      {detail.alerts.map((a) => <Tag key={a.alertType} color="orange">{ALERT_LABEL[a.alertType] ?? a.alertType}</Tag>)}
                      {detail.alerts.length === 0 && <Text type="secondary">无预警</Text>}
                    </div>
                  </div>
                ),
              },
            ]}
          />
        )}
      </Drawer>
    </div>
  );
}
