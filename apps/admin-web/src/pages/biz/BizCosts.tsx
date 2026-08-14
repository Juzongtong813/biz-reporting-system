import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Drawer, Form, Input, InputNumber, Modal, Select, Space, Table, Tag, Typography, message } from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { bizCostList, bizCostCreate, bizCostSubmit, bizCostApprove, bizCostReject, bizCostVoid, bizCostRestore, bizAdminCities } from '@/api/biz.api';

const { Title, Text } = Typography;

const STATUS: Record<string, { label: string; color: string }> = {
  draft: { label: '草稿', color: 'default' },
  pending: { label: '待审核', color: 'processing' },
  approved: { label: '已通过', color: 'success' },
  rejected: { label: '已驳回', color: 'error' },
  voided: { label: '已作废', color: 'default' },
};

const CATEGORY: Record<string, string> = {
  labor: '人工成本', utilities: '水电费', fuel: '油补', entertainment: '招待费',
  rent: '房租', reimbursement: '报销', other: '其他',
};

function fenToYuan(fen: number | null): string {
  return fen == null ? '-' : (fen / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** 地市成本（新基线 M5，不关联合同；审核授权默认 super_admin，可授权 admin） */
export default function BizCosts() {
  const navigate = useNavigate();
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [cities, setCities] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [costs, ct] = await Promise.all([bizCostList(), bizAdminCities()]);
      setItems(costs.items);
      setCities(ct.items.map((x) => ({ id: String(x.id), name: String(x.name) })));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const onCreate = async (values: Record<string, unknown>) => {
    try {
      await bizCostCreate({
        cityId: String(values.cityId),
        businessMonth: String(values.businessMonth),
        categoryCode: String(values.categoryCode),
        amountFen: Math.round(Number(values.amountFen) * 100),
        description: String(values.description ?? ''),
      });
      message.success('成本记录已创建（草稿）');
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
        bizCostReject(id, comment).then(() => { message.success('已驳回'); void load(); resolve(); }).catch((e) => { message.error('驳回失败'); reject(e); });
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
        bizCostVoid(id, reason).then(() => { message.success('已作废'); void load(); resolve(); }).catch((e) => { message.error('作废失败'); reject(e); });
      }),
    });
  };

  const columns = [
    { title: '地市', dataIndex: 'cityId', key: 'cityId', render: (v: string) => cities.find((c) => c.id === v)?.name ?? '-' },
    { title: '业务月份', dataIndex: 'businessMonth', key: 'businessMonth', width: 90 },
    { title: '分类', dataIndex: 'categoryCode', key: 'categoryCode', render: (v: string) => CATEGORY[v] ?? v },
    { title: '金额（元）', dataIndex: 'amountFen', key: 'amountFen', render: (v: number) => fenToYuan(Number(v)) },
    { title: '说明', dataIndex: 'description', key: 'description', ellipsis: true },
    { title: '状态', dataIndex: 'status', key: 'status', render: (v: string) => { const s = STATUS[v] ?? { label: v, color: 'default' }; return <Tag color={s.color}>{s.label}</Tag>; } },
    { title: '审核意见', dataIndex: 'reviewComment', key: 'reviewComment', ellipsis: true, render: (v: string | null) => v ?? '-' },
    {
      title: '操作', key: 'action', width: 260,
      render: (_: unknown, row: Record<string, unknown>) => (
        <Space>
          {['draft', 'rejected'].includes(String(row.status)) && <Button size="small" type="primary" onClick={() => run(() => bizCostSubmit(String(row.id)), '已提交审核')}>提交</Button>}
          {String(row.status) === 'pending' && <Button size="small" onClick={() => run(() => bizCostApprove(String(row.id)), '已审核通过')}>通过</Button>}
          {String(row.status) === 'pending' && <Button size="small" danger onClick={() => onReject(String(row.id))}>驳回</Button>}
          {String(row.status) === 'approved' && <Button size="small" danger onClick={() => onVoid(String(row.id))}>作废</Button>}
          {String(row.status) === 'voided' && <Button size="small" onClick={() => run(() => bizCostRestore(String(row.id)), '已恢复')}>恢复</Button>}
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24, background: '#F5F7F8', minHeight: '100vh' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>地市成本</Title>
          <Text type="secondary">独立核算不关联合同 · 分类必填 · 审核授权（默认 super_admin，可授权 admin）</Text>
        </div>
        <Space>
          <Button onClick={() => navigate('/biz/operation')}>返回经营管理</Button>
          <Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>新增成本</Button>
        </Space>
      </div>
      <Card>
        <Table rowKey="id" loading={loading} columns={columns} dataSource={items} pagination={{ pageSize: 10 }} />
      </Card>

      <Drawer title="新增地市成本（草稿）" open={createOpen} onClose={() => setCreateOpen(false)} width={420}>
        <Form form={form} layout="vertical" onFinish={onCreate}>
          <Form.Item name="cityId" label="地市" rules={[{ required: true }]}>
            <Select options={cities.map((c) => ({ value: c.id, label: c.name }))} />
          </Form.Item>
          <Form.Item name="businessMonth" label="业务月份（YYYY-MM）" rules={[{ required: true }]}><Input placeholder="2026-06" /></Form.Item>
          <Form.Item name="categoryCode" label="成本分类" rules={[{ required: true }]}>
            <Select options={Object.entries(CATEGORY).map(([value, label]) => ({ value, label }))} />
          </Form.Item>
          <Form.Item name="amountFen" label="金额（元）" rules={[{ required: true }]}><InputNumber min={0.01} precision={2} style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="description" label="说明"><Input.TextArea rows={2} /></Form.Item>
          <Button type="primary" htmlType="submit" block>保存草稿</Button>
        </Form>
      </Drawer>
    </div>
  );
}
