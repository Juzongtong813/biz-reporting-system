import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Col, Descriptions, Drawer, Progress, Row, Select, Space, Spin, Statistic, Table, Tag, Typography, message } from 'antd';
import {
  bizContractDetail,
  bizSnapshotDashboard,
  CONTRACT_STATUS_COLOR,
  CONTRACT_STATUS_TEXT,
  type BizContractDetail,
  type BizDashboardResult,
} from '@/api/biz.api';
import { useBizSnapshot } from '@/components/biz/BizSnapshotContext';
import { BizAnalysisFilter, EMPTY_ANALYSIS_FILTER, type AnalysisFilterValue } from '@/components/biz/BizAnalysisFilter';
const { Title } = Typography;
function fenToYuan(value: number | null | undefined): string { return (Number(value ?? 0) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
type Summary = Record<string, unknown>;

/** 期间标签：多月 → "2025年01月、03月"；仅年度 → "2025年度"；无 → "全部期间" */
function periodLabel(filter: AnalysisFilterValue): string {
  if (filter.months.length) {
    return `${filter.year}年${filter.months.map((m) => m.slice(5, 7)).join('月、')}月`;
  }
  if (filter.year) return `${filter.year}年度`;
  return '全部期间';
}

export default function BizAnalysisOverview() {
  const { meta, refreshMeta } = useBizSnapshot();
  const [filter, setFilter] = useState<AnalysisFilterValue>(EMPTY_ANALYSIS_FILTER);
  const [overview, setOverview] = useState<Summary | null>(null);
  const [alerts, setAlerts] = useState<Array<Record<string, unknown>>>([]);
  const [detail, setDetail] = useState<BizContractDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    const dashboard = await bizSnapshotDashboard({
      year: filter.year || undefined,
      months: filter.months,
      provinceIds: filter.provinceIds,
      cityIds: filter.cityIds,
    });
    const d = dashboard as BizDashboardResult;
    const rawOverview = d.overview as Summary & Record<string, unknown>;
    const orderCompletionFen = Number(rawOverview.orderCompletionFen ?? rawOverview.order_completion_fen ?? 0) || 0;
    const offlineCompletionFen = Number(rawOverview.offlineCompletionFen ?? rawOverview.offline_completion_fen ?? 0) || 0;
    const reportedTotal = Number(rawOverview.totalCompletionFen ?? rawOverview.completionFen ?? rawOverview.completion_fen);
    const totalCompletionFen = Number.isFinite(reportedTotal) && reportedTotal > 0
      ? reportedTotal
      : orderCompletionFen + offlineCompletionFen;
    setOverview({ ...rawOverview, orderCompletionFen, offlineCompletionFen, totalCompletionFen });
    // #2 防御：后端已不再写入 none/normal，这里再过滤一遍，避免历史快照残留行被渲染成"正常"
    setAlerts(d.contractAlerts.items.filter((a) => a.alertType !== 'none' && a.alertType !== 'normal') as Array<Record<string, unknown>>);
  }, [filter]);

  useEffect(() => { void load(); }, [load]);

  // 顶部"更新数据"生成新快照后（generatedAt 变化），自动刷新看板数据（共享状态源，无重复轮询）
  const lastGenRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (meta?.generatedAt === undefined) return;
    if (lastGenRef.current === undefined) { lastGenRef.current = meta.generatedAt; return; }
    if (lastGenRef.current !== meta.generatedAt) { lastGenRef.current = meta.generatedAt; void load(); }
  }, [meta?.generatedAt, load]);

  /** 合同预警点击：直接在当前页打开只读合同详情 Drawer，不跳转到合同管理/合同概览列表 */
  const openContractDetail = async (contractId: string) => {
    if (!contractId) return;
    setDetailOpen(true);
    setDetail(null);
    setDetailLoading(true);
    try {
      setDetail(await bizContractDetail(contractId));
    } catch {
      message.error('合同详情加载失败');
    } finally {
      setDetailLoading(false);
    }
  };

  return <div className="v3-content"><div className="v3-page-head"><div className="v3-page-titles"><Title level={4} style={{ margin: 0 }}>经营分析概览</Title><Typography.Text type="secondary">{periodLabel(filter)}</Typography.Text></div><Space wrap>
    <Button onClick={() => void load()}>刷新数据</Button>
  </Space></div>
    <BizAnalysisFilter value={filter} onChange={setFilter} />
    <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
      <Col xs={12} lg={4}><Card size="small"><Statistic title="当前合同数" value={Number(overview?.contractCount) || 0} /></Card></Col>
      <Col xs={12} lg={4}><Card size="small"><Statistic title="当前合同额（元）" value={fenToYuan(Number(overview?.totalContractAmountFen) || 0)} /></Card></Col>
      <Col xs={12} lg={4}><Card size="small"><Statistic title="订单完工（元）" value={fenToYuan(Number(overview?.orderCompletionFen) || 0)} /></Card></Col>
      <Col xs={12} lg={4}><Card size="small"><Statistic title="线下完工（元）" value={fenToYuan(Number(overview?.offlineCompletionFen) || 0)} /></Card></Col>
      <Col xs={12} lg={4}><Card size="small"><Statistic title="累计完工（元）" value={fenToYuan(Number(overview?.totalCompletionFen) || 0)} /></Card></Col>
      <Col xs={12} lg={4}><Card size="small"><Statistic title="净利（元）" value={fenToYuan(Number(overview?.netProfitFen) || 0)} /></Card></Col>
    </Row>
    {overview && overview.totalCompletionFen === undefined && (
      <Alert style={{ marginTop: 16 }} type="warning" showIcon message="累计完工数据异常：概览未返回 totalCompletionFen 字段，请检查快照概览指标或联系管理员" />
    )}
    {overview && Number(overview.totalCompletionFen) === 0 && Number(overview.totalContractAmountFen) > 0 && (
      <Alert style={{ marginTop: 8 }} type="info" showIcon message={`累计完工为 0 元（合同额 ${fenToYuan(Number(overview.totalContractAmountFen) || 0)} 元）：当前无有效订单完工或已审核线下完工记录，请确认数据是否已录入`} />
    )}
    <Card title="合同预警" size="small" style={{ marginTop: 16 }}><Table<Record<string, unknown>> size="small" rowKey={(row) => `${String(row.contractId ?? '')}-${String(row.alertType ?? '')}`} pagination={{ pageSize: 10 }} dataSource={alerts} locale={{ emptyText: '暂无预警' }} columns={[
      { title: '合同编号', dataIndex: 'contractNo', render: (value: string, row) => <Button type="link" size="small" onClick={() => void openContractDetail(String(row.contractId ?? ''))}>{value}</Button> },
      { title: '合同名称', dataIndex: 'contractName', ellipsis: true },
      { title: '预警类型', dataIndex: 'alertType', render: (value: string) => <span style={{ color: value === 'expired' ? '#cf1322' : value === 'expiring' ? '#fa8c16' : value === 'nearly_full' ? '#faad14' : value === 'overfull' ? '#cf1322' : '#999' }}>{({ expired: '已到期', expiring: '即将到期', nearly_full: '接近满额', overfull: '已满额/超额' } as Record<string, string>)[value] ?? value}</span> },
      { title: '到期日期', dataIndex: 'endDate', render: (value: string | null) => value ?? '-' },
      {
        title: '完工进度',
        key: 'progress',
        render: (_: unknown, row) => {
          const pct = row.completionProgressPct != null ? Number(row.completionProgressPct) : null;
          const fen = row.completionFen != null ? Number(row.completionFen) : null;
          const amount = row.contractAmountFen != null ? Number(row.contractAmountFen) : null;
          let ratio = pct;
          if (ratio == null && fen != null && amount != null && amount > 0) ratio = (fen / amount) * 100;
          if (ratio == null) return <span style={{ color: '#999' }}>-</span>;
          const color = ratio >= 100 ? '#cf1322' : ratio >= 80 ? '#faad14' : '#52c41a';
          // 两位小数显示（与快照库 completion_progress_pct DECIMAL(7,2) 口径一致）
          return <Progress percent={ratio} size="small" strokeColor={color} format={(p) => `${Number(p).toFixed(2)}%`} />;
        },
      },
    ]} /></Card>
    <Drawer title={detail ? `${detail.contract.contractName} / ${detail.contract.contractNo}` : '合同详情'} open={detailOpen} onClose={() => setDetailOpen(false)} width="88%">
      {detailLoading ? <div style={{ textAlign: 'center', padding: 48 }}><Spin /></div> : detail && <><Descriptions bordered size="small" column={2}><Descriptions.Item label="合同编号">{detail.contract.contractNo}</Descriptions.Item><Descriptions.Item label="合同名称">{detail.contract.contractName}</Descriptions.Item><Descriptions.Item label="状态"><Tag color={CONTRACT_STATUS_COLOR[detail.contract.status] ?? 'default'}>{CONTRACT_STATUS_TEXT[detail.contract.status] ?? detail.contract.status}</Tag></Descriptions.Item><Descriptions.Item label="含税合同额（元）">{fenToYuan(detail.contract.taxInclusiveAmountFen)}</Descriptions.Item><Descriptions.Item label="签订日期">{detail.contract.signedDate ?? '-'}</Descriptions.Item><Descriptions.Item label="合同期限">{detail.contract.startDate ?? '-'} 至 {detail.contract.endDate ?? '-'}</Descriptions.Item><Descriptions.Item label="税率">{detail.contract.taxRateRaw ?? '-'}</Descriptions.Item><Descriptions.Item label="合同分类">{[detail.contract.contractCategory1, detail.contract.contractCategory2].filter(Boolean).join(' / ') || '-'}</Descriptions.Item></Descriptions>
        <Alert style={{ marginTop: 16 }} type="info" message={`经营单位分配 ${detail.allocations.filter((allocation) => allocation.status === 'active').length} 条，累计完工 ${fenToYuan(detail.progress.totalCompletionFen)} 元`} />
        <Card title="管理费率" size="small" style={{ marginTop: 16 }}>
          <Table size="small" rowKey={(row) => `${row.cityId}-${row.effectiveMonth}`} dataSource={detail.feeRates} pagination={{ pageSize: 8 }} columns={[{ title: '经营单位', dataIndex: 'cityId', key: 'cityId', render: (cityId: string) => detail.allocations.find((allocation) => allocation.cityId === cityId)?.cityName ?? cityId }, { title: '生效月份', dataIndex: 'effectiveMonth', key: 'effectiveMonth' }, { title: '管理费率', dataIndex: 'rateBp', key: 'rateBp', render: (value: number) => `${(value / 100).toFixed(2)}%` }, { title: '说明', dataIndex: 'changeReason', key: 'changeReason', render: (value: string | null) => value ?? '-' }]} />
        </Card></>}
    </Drawer>
  </div>;
}
