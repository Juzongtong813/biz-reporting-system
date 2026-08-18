import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { App as AntdApp, Button, Card, Col, Row, Select, Space, Table, Tag, Typography } from 'antd';
import { DownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import {
  bizAnalysisOverview, bizAnalysisTrend, bizAnalysisByCity, bizAnalysisOverrunList, bizAnalysisAlerts,
  bizAggregateRecalc, bizAggregateCheck,
} from '@/api/biz.api';

const { Title, Text } = Typography;

function fenToYuan(fen: number): string {
  return (fen / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function analysisRowKey(row: Record<string, unknown>): string {
  return [row.type, row.month, row.dimension, row.contractId, row.cityId, row.detail]
    .filter((value) => value != null && value !== '')
    .map(String)
    .join(':');
}

/** 显示层月份统一 yyyy年mm月（数据库/接口保留 YYYY-MM） */
export function formatMonth(v: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})$/.exec(String(v ?? ''));
  return m ? `${m[1]}年${m[2]}月` : (v ?? '-');
}

/** 经营分析（新基线 M6）：概览/趋势/地市对比/超额清单 + 汇总重算与一致性核对 */
export default function BizAnalysis() {
  const navigate = useNavigate();
  const { message: msg, modal } = AntdApp.useApp();
  const [overview, setOverview] = useState<{ orderCompletionFen: number; offlineCompletionFen: number; grossProfitFen: number; costFen: number; netProfitFen: number; contractCount: number; totalContractAmountFen: number; totalCompletionFen: number } | null>(null);
  const [trend, setTrend] = useState<Array<Record<string, unknown>>>([]);
  const [cities, setCities] = useState<Array<Record<string, unknown>>>([]);
  const [overruns, setOverruns] = useState<Array<Record<string, unknown>>>([]);
  const [contractAlerts, setContractAlerts] = useState<Array<{ contractId: string; contractNo: string; contractName: string; alertType: string; endDate: string | null; status: string }>>([]);
  const [checkResult, setCheckResult] = useState<{ warningCount: number; warnings: Array<Record<string, unknown>> } | null>(null);
  const [filterMonth, setFilterMonth] = useState<string | undefined>(undefined);
  const [filterCity, setFilterCity] = useState<string | undefined>(undefined);
  const [cityOptions, setCityOptions] = useState<Array<{ label: string; value: string }>>([]);
  const [monthOptions, setMonthOptions] = useState<Array<{ label: string; value: string }>>([]);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    const params = { month: filterMonth, cityId: filterCity };
    const [ov, tr, ct, or, al] = await Promise.all([
      bizAnalysisOverview(params),
      bizAnalysisTrend(12, filterCity), bizAnalysisByCity(filterMonth), bizAnalysisOverrunList({ month: filterMonth, cityId: filterCity }), bizAnalysisAlerts(filterCity),
    ]);
    setOverview(ov);
    setTrend(tr.items);
    setContractAlerts(al.items);
    const cityRows = filterCity ? ct.items.filter((r: Record<string, unknown>) => String(r.cityId) === filterCity) : ct.items;
    setCities(cityRows);
    setOverruns(or.items);
    setCityOptions(ct.items.map((r: Record<string, unknown>) => ({ label: String(r.cityName ?? r.cityId ?? '').slice(0, 12), value: String(r.cityId) })));
    setMonthOptions(tr.items.map((r: Record<string, unknown>) => ({ label: formatMonth(String(r.month)), value: String(r.month) })));
  }, [filterMonth, filterCity]);

  useEffect(() => { void load(); }, [load]);

  /** CSV 导出当前地市指标视图（元，千分位两位小数） */
  const onExport = async () => {
    setExporting(true);
    try {
      const header = ['地市', '合同数量', '合同额(元)', '订单完工(元)', '线下完工(元)', '毛利(元)', '成本(元)', '净利(元)', '超额标记'];
      const rows = cities.map((r) => {
        const overrun = overruns.find((o) => o.type === 'city' && o.cityId === r.cityId);
        return [String(r.cityName ?? r.cityId ?? '-'), String(Number(r.contractCount) || 0), fenToYuan(Number(r.contractAmountFen) || 0), fenToYuan(Number(r.orderCompletionFen) || 0), fenToYuan(Number(r.offlineCompletionFen) || 0), fenToYuan(Number(r.grossProfitFen) || 0), fenToYuan(Number(r.costFen) || 0), fenToYuan(Number(r.netProfitFen) || 0), overrun ? `超额${fenToYuan(Number(overrun.overrunFen))}` : '-'];
      });
      const escapeCsv = (v: string) => (/[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v);
      const csv = '\uFEFF' + [header, ...rows].map((r) => r.map(escapeCsv).join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `经营分析-地市指标-${filterMonth ?? '累计'}.csv`;
      a.click(); URL.revokeObjectURL(url);
      msg.success(`已导出 ${rows.length} 条地市指标`);
    } finally {
      setExporting(false);
    }
  };

  const onRecalc = () => {
    modal.confirm({
      title: '全库重算汇总',
      content: '将按明细重新生成全部汇总（含二次确认）。确定执行？',
      okText: '确认重算',
      onOk: async () => {
        await bizAggregateRecalc({}, true);
        msg.success('全库重算完成');
        void load();
      },
    });
  };

  const onCheck = async () => {
    const r = await bizAggregateCheck();
    setCheckResult(r);
    if (r.warningCount === 0) msg.success('一致性核对通过：无警告');
    else msg.warning(`一致性核对发现 ${r.warningCount} 条警告（不自动改写数据）`);
  };

  const cards = [
    { label: '订单完工（元）', value: overview?.orderCompletionFen ?? 0, color: '#2878b8' },
    { label: '线下完工（元）', value: overview?.offlineCompletionFen ?? 0, color: '#0F766E' },
    { label: '毛利（元）', value: overview?.grossProfitFen ?? 0, color: '#2f9e62' },
    { label: '成本（元）', value: overview?.costFen ?? 0, color: '#c47b20' },
    { label: '净利（元）', value: overview?.netProfitFen ?? 0, color: (overview?.netProfitFen ?? 0) >= 0 ? '#2f9e62' : '#c64b4b' },
  ];

  return (
    <div className="v3-content">
      <div className="v3-page-head">
        <div className="v3-page-titles">
          <Title level={4} style={{ margin: 0 }}>经营分析</Title>
          <div className="v3-page-description">汇总口径：订单 + 线下完工 - 作废 · 利润 = 毛利 - 成本</div>
        </div>
        <Space className="v3-page-head-actions" wrap>
          <Button onClick={() => navigate('/biz/operation')}>返回经营管理</Button>
          <Button onClick={onCheck}>一致性核对</Button>
          <Button danger onClick={onRecalc}>全库重算</Button>
          <Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button>
        </Space>
      </div>
      <div className="v3-toolbar">
        <Select data-testid="analysis-month-filter"
          allowClear placeholder="月份筛选（经营金额）" style={{ width: 170 }} options={monthOptions}
          value={filterMonth} onChange={(v) => setFilterMonth(v ?? undefined)}
        />
        <Select data-testid="analysis-city-filter"
          allowClear placeholder="地市筛选" style={{ width: 170 }} options={cityOptions}
          value={filterCity} onChange={(v) => setFilterCity(v ?? undefined)}
        />
        {(filterMonth || filterCity) && <Button data-testid="analysis-clear-filter" onClick={() => { setFilterMonth(undefined); setFilterCity(undefined); }}>清空筛选</Button>}
        <Button data-testid="analysis-export" icon={<DownloadOutlined />} loading={exporting} onClick={onExport}>导出当前视图</Button>
      </div>
      <div className="v3-note">月份筛选仅影响经营金额与超额；合同数量/合同额为累计库存口径，不受月份影响；提醒为累计实时口径（到期/满额），不受月份筛选影响。</div>

      <div className="biz-metric-strip">
        <div className="v3-metric"><span className="v3-metric-label">合同数量</span><span className="v3-metric-value" style={{ color: '#2878b8' }}>{overview?.contractCount ?? 0}</span></div>
        <div className="v3-metric"><span className="v3-metric-label">总合同额（元）</span><span className="v3-metric-value" style={{ color: '#2878b8' }}>{fenToYuan(overview?.totalContractAmountFen ?? 0)}</span></div>
        <div className="v3-metric"><span className="v3-metric-label">总完工（元）</span><span className="v3-metric-value" style={{ color: '#0F766E' }}>{fenToYuan(overview?.totalCompletionFen ?? 0)}</span></div>
        {cards.map((c) => (
          <div className="v3-metric" key={c.label}><span className="v3-metric-label">{c.label}</span><span className="v3-metric-value" style={{ color: c.color }}>{fenToYuan(c.value)}</span></div>
        ))}
        <div className="v3-metric"><span className="v3-metric-label">一致性警告</span><span className="v3-metric-value" style={{ color: checkResult && checkResult.warningCount > 0 ? '#c64b4b' : '#2f9e62' }}>{checkResult ? checkResult.warningCount : '-'}</span></div>
      </div>

      {(contractAlerts.length > 0 || overruns.length > 0) && (
        <Card size="small" title="提醒中心" style={{ marginBottom: 16, borderLeft: '3px solid #c64b4b' }}>
          <Space wrap>
            {contractAlerts.slice(0, 10).map((a, i) => (
              <Tag key={`a${i}`} color={a.alertType === 'expired' || a.alertType === 'overfull' ? 'red' : a.alertType === 'expiring' ? 'orange' : 'blue'}>
                {a.alertType === 'expiring' ? '即将到期' : a.alertType === 'expired' ? '已到期' : a.alertType === 'nearly_full' ? '即将满额' : '满额完成'} {String(a.contractNo ?? a.contractId ?? '').slice(0, 14)}
              </Tag>
            ))}
            {overruns.slice(0, 8).map((o, i) => (
              <Tag key={`o${i}`} color={o.type === 'contract' ? 'red' : 'orange'}>
                {o.type === 'contract' ? `合同 ${String(o.contractNo ?? o.id ?? '').slice(0, 12)}` : `地市 ${String(o.cityId ?? '').slice(0, 8)}`} 超额 {fenToYuan(Number(o.overrunFen))}
              </Tag>
            ))}
            {(contractAlerts.length > 10 || overruns.length > 8) && <Text type="secondary">…共 {contractAlerts.length + overruns.length} 项</Text>}
          </Space>
        </Card>
      )}

      {checkResult && checkResult.warningCount > 0 && (
        <Card size="small" title={`一致性警告（${checkResult.warningCount} 条，仅告警不自动改写）`} style={{ marginBottom: 16 }}>
          <Table scroll={{ x: "max-content" }} 
            size="small" rowKey={analysisRowKey} pagination={false} dataSource={checkResult.warnings.slice(0, 20)}
            columns={[
              { title: '类型', dataIndex: 'type', key: 'type' },
              { title: '月份', dataIndex: 'month', key: 'month', render: (v: string) => formatMonth(v) },
              { title: '维度', dataIndex: 'dimension', key: 'dimension' },
              { title: '说明', dataIndex: 'detail', key: 'detail' },
            ]}
          />
        </Card>
      )}

      <Row gutter={12}>
        <Col xs={24} lg={10}>
          <Card title="月度趋势（近 12 月）" size="small" style={{ marginBottom: 16 }}>
            <Table scroll={{ x: "max-content" }} 
              size="small" rowKey="month" pagination={false} dataSource={trend}
              columns={[
                { title: '月份', dataIndex: 'month', key: 'month', render: (v: string) => formatMonth(v) },
                { title: '订单完工（元）', dataIndex: 'orderCompletionFen', key: 'oc', render: (v: number) => fenToYuan(Number(v)) },
                { title: '线下完工（元）', dataIndex: 'offlineCompletionFen', key: 'of', render: (v: number) => fenToYuan(Number(v)) },
                { title: '毛利（元）', dataIndex: 'grossProfitFen', key: 'gp', render: (v: number) => fenToYuan(Number(v)) },
                { title: '净利（元）', dataIndex: 'netProfitFen', key: 'np', render: (v: number) => fenToYuan(Number(v)) },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} lg={6}>
          <Card title="地市对比" size="small" style={{ marginBottom: 16 }}>
            <div data-testid="analysis-city-table">
            <Table scroll={{ x: "max-content" }} 
              size="small" rowKey="cityId" pagination={false} dataSource={cities}
              columns={[
                { title: '地市', dataIndex: 'cityName', key: 'cityName', fixed: 'left', render: (_: unknown, r: Record<string, unknown>) => String(r.cityName ?? r.cityId ?? '-').slice(0, 12) },
                { title: '合同数', dataIndex: 'contractCount', key: 'cc', render: (v: number) => Number(v) || 0 },
                { title: '合同额（元）', dataIndex: 'contractAmountFen', key: 'ca', render: (v: number) => fenToYuan(Number(v)) },
                { title: '订单完工（元）', dataIndex: 'orderCompletionFen', key: 'oc', render: (v: number) => fenToYuan(Number(v)) },
                { title: '线下完工（元）', dataIndex: 'offlineCompletionFen', key: 'of', render: (v: number) => fenToYuan(Number(v)) },
                { title: '毛利（元）', dataIndex: 'grossProfitFen', key: 'gp', render: (v: number) => fenToYuan(Number(v)) },
                { title: '成本（元）', dataIndex: 'costFen', key: 'co', render: (v: number) => fenToYuan(Number(v)) },
                { title: '净利（元）', dataIndex: 'netProfitFen', key: 'np', render: (v: number) => fenToYuan(Number(v)) },
                { title: '超额标记', key: 'overrun', render: (_: unknown, r: Record<string, unknown>) => {
                    const o = overruns.find((x) => x.type === 'city' && x.cityId === r.cityId);
                    return o ? <Tag color="red">超额 {fenToYuan(Number(o.overrunFen))}</Tag> : <Tag color="green">正常</Tag>;
                  } },
              ]}
            />
            </div>
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card title="超额清单" size="small">
            <Table scroll={{ x: "max-content" }} 
              size="small" rowKey={analysisRowKey} pagination={false} dataSource={overruns}
              columns={[
                { title: '类型', dataIndex: 'type', key: 'type', render: (v: string) => v === 'contract' ? <Tag color="red">合同超额</Tag> : <Tag color="orange">地市超额</Tag> },
                { title: '合同/地市', dataIndex: 'contractNo', key: 'no', render: (_: unknown, r: Record<string, unknown>) => String(r.contractNo ?? (r.cityId ? String(r.cityId).slice(0, 8) : '-')) },
                { title: '超额（元）', dataIndex: 'overrunFen', key: 'of', render: (v: number) => <Tag color="red">{fenToYuan(Number(v))}</Tag> },
              ]}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
