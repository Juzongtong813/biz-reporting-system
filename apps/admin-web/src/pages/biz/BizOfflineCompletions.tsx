import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Card, Drawer, Form, Input, InputNumber, Modal, Select, Space, Table, Tag, Typography, message } from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { bizOfflineList, bizOfflineCreate, bizOfflineSubmit, bizOfflineApprove, bizOfflineReject, bizOfflineVoid, bizOfflineRestore, bizContractList, bizAdminCities } from '@/api/biz.api';

const { Title, Text } = Typography;

const STATUS: Record<string, { label: string; color: string }> = {
  draft: { label: '草稿', color: 'default' },
  pending: { label: '待审核', color: 'processing' },
  approved: { label: '已通过', color: 'success' },
  rejected: { label: '已驳回', color: 'error' },
  voided: { label: '已作废', color: 'default' },
};

function fenToYuan(fen: number | null): string {
  return fen == null ? '-' : (fen / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** 线下完工（新基线 M5） */
export default function BizOfflineCompletions() {
  const navigate = useNavigate();
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [contracts, setContracts] = useState<Array<{ id: string; contractNo: string }>>([]);
  const [cities, setCities] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [off, c, ct] = await Promise.all([
        bizOfflineList(), bizContractList(), bizAdminCities(),
      ]);
      setItems(off.items);
      setContracts(c.items.map((x) => ({ id: x.id, contractNo: x.contractNo })));
      setCities(ct.items.map((x) => ({ id: String(x.id), name: String(x.name) })));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const onCreate = async (values: Record<string, unknown>) => {
    try {
      await bizOfflineCreate({
        contractId: String(values.contractId),
        cityId: String(values.cityId),
        businessMonth: String(values.businessMonth),
        amountFen: Math.round(Number(values.amountFen) * 100),
        summary: String(values.summary ?? ''),
      });
      message.success('完工记录已创建（草稿）');
      setCreateOpen(false);
      form.resetFields();
      void load();
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { message?: string | string[] } } }).response?.data?.message;
      message.error(Array.isArray(detail) ? detail.join('；') : (detail ?? '创建失败'));
    }
  };

  const run = async (fn: () => Promise<unknown>, okMsg: string) => {
    try {
      await fn();
      message.success(okMsg);
      void load();
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { message?: string } } }).response?.data?.message;
      message.error(detail ?? '操作失败');
    }
  };

  const onReject = (id: string) => {
    Modal.confirm({
      title: '驳回',
      onOk: () => new Promise<void>((resolve, reject) => {
        const comment = window.prompt('驳回原因（必填）：');
        if (!comment?.trim()) { message.warning('驳回原因必填'); reject(); return; }
        bizOfflineReject(id, comment).then(() => { message.success('已驳回'); void load(); resolve(); }).catch((e) => { message.error('驳回失败'); reject(e); });
      }),
    });
  };

  const onVoid = (id: string) => {
    Modal.confirm({
      title: '作废（退出统计）',
      okText: '确认作废',
      okButtonProps: { danger: true },
      onOk: () => new Promise<void>((resolve, reject) => {
        const reason = window.prompt('作废原因（必填）：');
        if (!reason?.trim()) { message.warning('作废原因必填'); reject(); return; }
        bizOfflineVoid(id, reason).then(() => { message.success('已作废'); void load(); resolve(); }).catch((e) => { message.error('作废失败'); reject(e); });
      }),
    });
  };

  const columns = [
    { title: '合同编号', dataIndex: 'contractId', key: 'contractId', render: (v: string) => contracts.find((c) => c.id === v)?.contractNo ?? v?.slice(0, 8) ?? '-' },
    { title: '地市', dataIndex: 'cityId', key: 'cityId', render: (v: string) => cities.find((c) => c.id === v)?.name ?? '-' },
    { title: '业务月份', dataIndex: 'businessMonth', key: 'businessMonth', width: 90 },
    { title: '金额（元）', dataIndex: 'amountFen', key: 'amountFen', render: (v: number) => fenToYuan(Number(v)) },
    { title: '说明', dataIndex: 'summary', key: 'summary', ellipsis: true },
    { title: '状态', dataIndex: 'status', key: 'status', render: (v: string) => { const s = STATUS[v] ?? { label: v, color: 'default' }; return <Tag color={s.color}>{s.label}</Tag>; } },
    { title: '审核意见', dataIndex: 'reviewComment', key: 'reviewComment', ellipsis: true, render: (v: string | null) => v ?? '-' },
    {
      title: '操作', key: 'action', width: 260,
      render: (_: unknown, row: Record<string, unknown>) => (
        <Space wrap>
          {['draft', 'rejected'].includes(String(row.status)) && <Button size="small" type="primary" onClick={() => run(() => bizOfflineSubmit(String(row.id)), '已提交审核')}>提交</Button>}
          {String(row.status) === 'pending' && <Button size="small" onClick={() => run(() => bizOfflineApprove(String(row.id)), '已审核通过')}>通过</Button>}
          {String(row.status) === 'pending' && <Button size="small" danger onClick={() => onReject(String(row.id))}>驳回</Button>}
          {String(row.status) === 'approved' && <Button size="small" danger onClick={() => onVoid(String(row.id))}>作废</Button>}
          {String(row.status) === 'voided' && <Button size="small" onClick={() => run(() => bizOfflineRestore(String(row.id)), '已恢复')}>恢复</Button>}
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24, background: '#F5F7F8', minHeight: '100vh' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>线下完工</Title>
          <Text type="secondary">地市用户仅本地市 · 金额大于 0 · 月份非未来 · 合同已分配本地市</Text>
        </div>
        <Space wrap>
          <Button onClick={() => navigate('/biz/operation')}>返回经营管理</Button>
          <Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>新建完工</Button>
        </Space>
      </div>
      <Card>
        <Table scroll={{ x: "max-content" }}  rowKey="id" loading={loading} columns={columns} dataSource={items} pagination={{ pageSize: 10 }} />
      </Card>

      <Drawer title="新建线下完工（草稿）" open={createOpen} onClose={() => setCreateOpen(false)} width={420}>
        <Form form={form} layout="vertical" onFinish={onCreate}>
          <Form.Item name="contractId" label="合同" rules={[{ required: true }]}>
            <Select showSearch optionFilterProp="label" options={contracts.map((c) => ({ value: c.id, label: c.contractNo }))} />
          </Form.Item>
          <Form.Item name="cityId" label="地市" rules={[{ required: true }]}>
            <Select options={cities.map((c) => ({ value: c.id, label: c.name }))} />
          </Form.Item>
          <Form.Item name="businessMonth" label="业务月份（YYYY-MM）" rules={[{ required: true }]}><Input placeholder="2026-06" /></Form.Item>
          <Form.Item name="amountFen" label="完工金额（元）" rules={[{ required: true }]}><InputNumber min={0.01} precision={2} style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="summary" label="说明" rules={[{ required: true }]}><Input.TextArea rows={2} /></Form.Item>
          <Button type="primary" htmlType="submit" block>保存草稿</Button>
        </Form>
      </Drawer>
    </div>
  );
}
