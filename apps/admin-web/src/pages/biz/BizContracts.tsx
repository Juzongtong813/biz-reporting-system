import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Badge, Button, Card, Descriptions, Drawer, Form, Input, InputNumber, Modal, Progress, Select, Space, Table, Tabs, Tag, Typography, message,
} from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  bizAdminProvinces, bizAdminCities,
  bizContractList, bizContractCreate, bizContractDetail, bizContractUpdate,
  bizContractActivate, bizContractVoid, bizContractUpsertAllocation,
  bizContractCancelAllocation, bizContractAddFeeRate,
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

function fenToYuan(fen: number): string {
  return (fen / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** 合同管理（新基线 M3）：列表 + 全屏详情弹窗 */
export default function BizContracts() {
  const navigate = useNavigate();
  const [items, setItems] = useState<BizContractItem[]>([]);
  const [provinces, setProvinces] = useState<Array<{ id: string; name: string }>>([]);
  const [cities, setCities] = useState<Array<{ id: string; name: string; provinceId: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [createOpen, setCreateOpen] = useState(false);
  const [detail, setDetail] = useState<BizContractDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [createForm] = Form.useForm();
  const [allocForm] = Form.useForm();
  const [rateForm] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, p, c] = await Promise.all([
        bizContractList(statusFilter ? { status: statusFilter } : {}),
        bizAdminProvinces(), bizAdminCities(),
      ]);
      setItems(list.items);
      setProvinces(p.items.map((x) => ({ id: String(x.id), name: String(x.name) })));
      setCities(c.items.map((x) => ({ id: String(x.id), name: String(x.name), provinceId: String(x.provinceId) })));
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { void load(); }, [load]);

  const openDetail = async (id: string) => {
    setDetailOpen(true);
    setDetailLoading(true);
    try {
      const d = await bizContractDetail(id);
      setDetail(d);
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
      await bizContractAddFeeRate(id, String(values.cityId), String(values.effectiveMonth), Number(values.rateBp), String(values.changeReason ?? ''));
      message.success('费率已保存');
      rateForm.resetFields();
      await openDetail(id);
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { message?: string } } }).response?.data?.message;
      message.error(detail ?? '费率保存失败');
    }
  };

  const columns = [
    { title: '合同编号', dataIndex: 'contractNo', key: 'contractNo', render: (v: string, row: BizContractItem) => <a onClick={() => openDetail(row.id)}>{v}</a> },
    { title: '合同名称', dataIndex: 'contractName', key: 'contractName', ellipsis: true },
    { title: '含税合同额（元）', dataIndex: 'taxInclusiveAmountFen', key: 'amount', render: (v: number) => fenToYuan(Number(v)) },
    { title: '状态', dataIndex: 'status', key: 'status', render: (v: string) => <Tag color={STATUS_COLOR[v]}>{STATUS_LABEL[v] ?? v}</Tag> },
    { title: '预警', dataIndex: 'tags', key: 'tags', render: (tags?: string[]) => tags?.map((t) => <Tag key={t} color="orange">{ALERT_LABEL[t] ?? t}</Tag>) },
    {
      title: '操作', key: 'action', width: 200,
      render: (_: unknown, row: BizContractItem) => (
        <Space wrap>
          <Button size="small" onClick={() => openDetail(row.id)}>详情</Button>
          {row.status === 'draft' && <Button size="small" type="primary" onClick={() => onActivate(row.id)}>生效</Button>}
          {['active', 'completed'].includes(row.status) && <Button size="small" danger onClick={() => onVoid(row.id)}>作废</Button>}
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24, background: '#F5F7F8', minHeight: '100vh' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>合同管理</Title>
          <Text type="secondary">新基线（biz_）· 合同号唯一 · 生效后合同额锁定</Text>
        </div>
        <Space wrap>
          <Button onClick={() => navigate('/biz/orders')}>订单管理</Button>
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
        <Table scroll={{ x: "max-content" }}  rowKey="id" loading={loading} columns={columns} dataSource={items} pagination={{ pageSize: 10 }} />
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
                      <Descriptions.Item label="开始日期">{detail.contract.startDate ?? '-'}</Descriptions.Item>
                      <Descriptions.Item label="结束日期">{detail.contract.endDate ?? '-'}</Descriptions.Item>
                      <Descriptions.Item label="父合同">{detail.contract.parentContractId ?? '-'}</Descriptions.Item>
                      <Descriptions.Item label="版本号">{detail.contract.versionNo}</Descriptions.Item>
                    </Descriptions>
                    <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
                      {detail.contract.status === 'draft' && <Button type="primary" onClick={() => onActivate(detail.contract.id)}>生效并锁定合同额</Button>}
                      {['active', 'completed'].includes(detail.contract.status) && <Button danger onClick={() => onVoid(detail.contract.id)}>作废合同</Button>}
                    </div>
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
                      <Form.Item name="rateBp" rules={[{ required: true }]}><InputNumber placeholder="费率(%)" min={0.01} max={100} precision={2} style={{ width: 110 }} /></Form.Item>
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
                          <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>按本地市分配额度 {fenToYuan(detail.progress.quotaFen ?? 0)} 计算</Text>
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
