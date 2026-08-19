import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBizPermission } from '@/utils/biz-permission';
import { Badge, Button, Card, Drawer, Form, Input, Modal, Select, Space, Spin, Table, Tag, Typography, Upload, message } from 'antd';
import { InboxOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  bizOrderBatches, bizOrderBatchDetail, bizOrderUpload, bizOrderBatchVoid, bizOrderBatchRestore, bizOrderRows,
} from '@/api/biz.api';

const { Title } = Typography;

const BATCH_STATUS: Record<string, { label: string; color: string }> = {
  parsing: { label: '解析中', color: 'processing' },
  imported: { label: '已导入', color: 'success' },
  failed: { label: '导入失败', color: 'error' },
  voided: { label: '已作废', color: 'default' },
};


/** 显示层月份统一 yyyy年mm月（数据库/接口保留 YYYY-MM） */
function formatMonth(v: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})$/.exec(String(v ?? ''));
  return m ? `${m[1]}年${m[2]}月` : (v ?? '-');
}

function fenToYuan(fen: number | null): string {
  if (fen === null || fen === undefined) return '-';
  return (fen / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** 订单管理（新基线 M4）：上传/批次/错误报告/订单行（敏感列脱敏） */
export default function BizOrders() {
  const navigate = useNavigate();
  const canUpload = useBizPermission('operation.order.upload');
  const [batches, setBatches] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<{ batch: Record<string, unknown>; errors: Array<Record<string, unknown>>; rowCount: number } | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [overrunFilter, setOverrunFilter] = useState<string | undefined>();
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [rowsLoading, setRowsLoading] = useState(false);

  // 页面级权限保护：无上传权限的账号直接跳回经营管理，避免停留在无意义页面。
  // canUpload === null 时保持加载态，防止权限判定前闪现订单内容。
  useEffect(() => {
    if (canUpload === false) navigate('/biz/operation', { replace: true });
  }, [canUpload, navigate]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await bizOrderBatches();
      setBatches(data.items);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (canUpload !== true) return;
    void load();
  }, [load, canUpload]);

  const loadRows = useCallback(async () => {
    setRowsLoading(true);
    try {
      const data = await bizOrderRows(overrunFilter ? { overrun: overrunFilter as 'city' | 'contract' | 'any' } : {});
      setRows(data.items);
    } finally {
      setRowsLoading(false);
    }
  }, [overrunFilter]);

  useEffect(() => {
    if (canUpload !== true) return;
    void loadRows();
  }, [loadRows, canUpload]);

  if (canUpload !== true) {
    return (
      <div style={{ minHeight: 240, display: 'grid', placeItems: 'center' }}>
        <Spin tip={canUpload === false ? '当前账号无订单上传权限，正在返回…' : '正在加载权限…'}>
          <div style={{ minHeight: 120, minWidth: 240 }} />
        </Spin>
      </div>
    );
  }

  const onUpload = async (file: File) => {
    const idempotencyKey = `up-${dayjs().format('YYYYMMDDHHmmss')}-${Math.random().toString(36).slice(2, 10)}`;
    try {
      const result = await bizOrderUpload(file, idempotencyKey);
      message.success(`批次已提交：${result.batchId.slice(0, 8)}，开始解析`);
      void load();
    } catch (e: unknown) {
      const detailMsg = (e as { response?: { data?: { message?: string | string[] } } }).response?.data?.message;
      message.error(Array.isArray(detailMsg) ? detailMsg.join('；') : (detailMsg ?? '上传失败'));
    }
    return false;
  };

  const openDetail = async (id: string) => {
    setDetailOpen(true);
    try {
      const d = await bizOrderBatchDetail(id);
      setDetail(d);
    } catch {
      message.error('批次详情加载失败');
    }
  };

  const onVoid = (id: string) => {
    Modal.confirm({
      title: '作废订单批次',
      content: '作废后该批次订单退出统计（原始行保留）。仅 super_admin 可操作，必须填写原因。',
      okText: '确认作废',
      okButtonProps: { danger: true },
      onOk: () => new Promise<void>((resolve, reject) => {
        const reason = window.prompt('作废原因（必填）：');
        if (!reason?.trim()) { message.warning('请填写作废原因'); reject(); return; }
        bizOrderBatchVoid(id, reason).then(() => { message.success('已作废'); void load(); resolve(); }).catch((e) => { message.error('作废失败'); reject(e); });
      }),
    });
  };

  const onRestore = async (id: string) => {
    try {
      await bizOrderBatchRestore(id);
      message.success('批次已恢复');
      void load();
    } catch (e: unknown) {
      const detailMsg = (e as { response?: { data?: { message?: string } } }).response?.data?.message;
      message.error(detailMsg ?? '恢复失败');
    }
  };

  const columns = [
    { title: '文件名', dataIndex: 'filename', key: 'filename', ellipsis: true },
    { title: '状态', dataIndex: 'status', key: 'status', render: (v: string) => { const s = BATCH_STATUS[v] ?? { label: v, color: 'default' }; return <Badge status={s.color as 'success' | 'processing' | 'error' | 'default'} text={s.label} />; } },
    { title: '总行数', dataIndex: 'totalRows', key: 'totalRows' },
    { title: '入账行数', dataIndex: 'importedRows', key: 'importedRows' },
    { title: '上传人', dataIndex: 'uploadedBy', key: 'uploadedBy', render: (v: string) => v?.slice(0, 8) ?? '-' },
    { title: '上传时间', dataIndex: 'uploadedAt', key: 'uploadedAt', render: (v: string) => v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '-' },
    { title: '失败原因', dataIndex: 'failureReason', key: 'failureReason', ellipsis: true, render: (v: string | null) => v ? <Tag color="red">{v.slice(0, 40)}</Tag> : '-' },
    {
      title: '操作', key: 'action', width: 220,
      render: (_: unknown, row: Record<string, unknown>) => (
        <Space wrap>
          <Button size="small" onClick={() => openDetail(String(row.id))}>详情</Button>
          {row.status === 'imported' && <Button size="small" danger onClick={() => onVoid(String(row.id))}>作废</Button>}
          {row.status === 'voided' && <Button size="small" onClick={() => onRestore(String(row.id))}>恢复</Button>}
        </Space>
      ),
    },
  ];

  const rowColumns = [
    { title: '行号', dataIndex: 'sourceRowNo', key: 'sourceRowNo', width: 70 },
    { title: '采购订单编号', dataIndex: 'purchaseOrderNo', key: 'purchaseOrderNo', width: 130 },
    { title: '地市', dataIndex: 'cityName', key: 'cityName', width: 90 },
    { title: '业务月份', dataIndex: 'businessMonth', key: 'businessMonth', width: 110, render: (v: string) => formatMonth(v) },
    { title: '含税金额（元）', dataIndex: 'completionAmountFen', key: 'completionAmountFen', render: (v: number | null) => <span style={{ color: Number(v) < 0 ? '#c64b4b' : undefined }}>{fenToYuan(v)}</span> },
    { title: '费率快照', dataIndex: 'feeRateSnapshotBp', key: 'feeRateSnapshotBp', render: (v: number | null) => v != null ? `${(v / 100).toFixed(2)}%` : '-' },
    { title: '毛利润（元）', dataIndex: 'grossProfitFen', key: 'grossProfitFen', render: (v: number | null) => fenToYuan(v) },
    { title: '收货人电话', dataIndex: 'receiverPhone', key: 'receiverPhone' },
    { title: '收货地址', dataIndex: 'receiverAddress', key: 'receiverAddress', ellipsis: true },
    { title: '状态', dataIndex: 'isVoid', key: 'isVoid', render: (v: boolean) => v ? <Tag color="red">已作废</Tag> : <Tag color="green">有效</Tag> },
  ];

  return (
    <div className="v3-content">
      <div className="v3-page-head">
        <div className="v3-page-titles">
          <Title level={4} style={{ margin: 0 }}>订单管理</Title>
        </div>
        <Space className="v3-page-head-actions" wrap>
          <Select
            allowClear placeholder="超额筛选" style={{ width: 150 }} value={overrunFilter}
            onChange={(v) => setOverrunFilter(v)}
            options={[
              { value: 'city', label: '超地市额度' },
              { value: 'contract', label: '超合同额' },
              { value: 'any', label: '任一超额' },
            ]}
          />
          <Button icon={<ReloadOutlined />} onClick={() => { void load(); void loadRows(); }}>刷新</Button>
          <Button onClick={() => navigate('/biz/operation')}>返回合同管理</Button>
        </Space>
      </div>

      <Card title="上传订单文件（.xlsx，≤50MB，≤20 万行，单工作表）" style={{ marginBottom: 16 }}>
        <Upload.Dragger
          accept=".xlsx"
          beforeUpload={onUpload}
          maxCount={1}
          showUploadList={false}
        >
          <p className="ant-upload-drag-icon"><InboxOutlined /></p>
          <p className="ant-upload-text">点击或拖拽 .xlsx 文件到此处上传</p>
          <p className="ant-upload-hint">上传即视为导入确认（无内容审核）；整批校验任一错误零写入</p>
        </Upload.Dragger>
      </Card>

      <Card title="导入批次" style={{ marginBottom: 16 }}>
        <Table scroll={{ x: "max-content" }}  rowKey="id" size="small" loading={loading} columns={columns} dataSource={batches} pagination={{ pageSize: 8 }} />
      </Card>

      <Card title={`订单行（共 ${rows.length} 条展示）`}>
        <Table scroll={{ x: "max-content" }}  rowKey="id" size="small" loading={rowsLoading} columns={rowColumns} dataSource={rows} pagination={{ pageSize: 10 }} />
      </Card>

      <Drawer title="批次详情" open={detailOpen} onClose={() => setDetailOpen(false)} width={720}>
        {detail && (
          <div>
            <p><b>文件：</b>{String(detail.batch.filename)}</p>
            <p><b>状态：</b>{BATCH_STATUS[String(detail.batch.status)]?.label ?? detail.batch.status}（{String(detail.rowCount)} 行入库）</p>
            {detail.batch.failureReason ? <p><b>失败原因：</b>{String(detail.batch.failureReason)}</p> : null}
            {detail.errors.length > 0 && (
              <>
                <p><b>错误报告（{detail.errors.length} 条，最多展示 100 条）：</b></p>
                <Table scroll={{ x: "max-content" }} 
                  size="small" rowKey="id" pagination={false}
                  dataSource={detail.errors.slice(0, 100)}
                  columns={[
                    { title: '行号', dataIndex: 'rowNo', key: 'rowNo', width: 70, render: (v: number | null) => v ?? '-' },
                    { title: '类型', dataIndex: 'errorType', key: 'errorType', width: 90 },
                    { title: '字段', dataIndex: 'field', key: 'field', width: 110, render: (v: string | null) => v ?? '-' },
                    { title: '说明', dataIndex: 'message', key: 'message' },
                  ]}
                />
              </>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}
