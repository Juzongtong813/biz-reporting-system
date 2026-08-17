import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Col, Modal, Row, Select, Space, Table, Tag, Typography, message } from 'antd';
import { DownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import {
  bizAnalysisOverview, bizAnalysisTrend, bizAnalysisByCity, bizAnalysisOverrunList,
  bizAggregateRecalc, bizAggregateCheck,
} from '@/api/biz.api';

const { Title, Text } = Typography;

function fenToYuan(fen: number): string {
  return (fen / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** 经营分析（新基线 M6）：概览/趋势/地市对比/超额清单 + 汇总重算与一致性核对 */
export default function BizAnalysis() {
  const navigate = useNavigate();
  const [overview, setOverview] = useState<{ orderCompletionFen: number; offlineCompletionFen: number; grossProfitFen: number; costFen: number; netProfitFen: number; contractCount: number; totalContractAmountFen: number; totalCompletionFen: number } | null>(null);
  const [trend, setTrend] = useState<Array<Record<string, unknown>>>([]);
  const [cities, setCities] = useState<Array<Record<string, unknown>>>([]);
  const [overruns, setOverruns] = useState<Array<Record<string, unknown>>>([]);
  const [checkResult, setCheckResult] = useState<{ warningCount: number; warnings: Array<Record<string, unknown>> } | null>(null);
  const [filterMonth, setFilterMonth] = useState<string | undefined>(undefined);
  const [filterCity, setFilterCity] = useState<string | undefined>(undefined);
  const [cityOptions, setCityOptions] = useState<Array<{ label: string; value: string }>>([]);
  const [monthOptions, setMonthOptions] = useState<Array<{ label: string; value: string }>>([]);

  const load = useCallback(async () => {
    const params = { month: filterMonth, cityId: filterCity };
    const [ov, tr, ct, or] = await Promise.all([
      bizAnalysisOverview(params),
      bizAnalysisTrend(12, filterCity), bizAnalysisByCity(filterMonth), bizAnalysisOverrunList(),
    ]);
    setOverview(ov);
    setTrend(tr.items);
    const cityRows = filterCity ? ct.items.filter((r) => r.cityId === filterCity) : ct.items;
    setCities(cityRows);
    setOverruns(or.items);
    setCityOptions(ct.items.map((r) => ({ label: String(r.cityName ?? r.cityId ?? '').slice(0, 12), value: String(r.cityId) })));
    setMonthOptions(tr.items.map((r) => ({ label: String(r.month), value: String(r.month) })));
  }, [filterMonth, filterCity]);

  useEffect(() => { void load(); }, [load]);

  /** CSV 导出当前地市指标视图（元，千分位两位小数） */
  const onExport = () => {
    const header = ['地市', '订单完工(元)', '线下完工(元)', '毛利(元)', '成本(元)', '净利(元)', '超额标记'];
    const rows = cities.map((r) => {
      const overrun = overruns.find((o) => o.type === 'city' && o.cityId === r.cityId);
      return [String(r.cityId ?? '').slice(0, 8), fenToYuan(Number(r.orderCompletionFen) || 0), fenToYuan(Number(r.offlineCompletionFen) || 0), fenToYuan(Number(r.grossProfitFen) || 0), fenToYuan(Number(r.costFen) || 0), fenToYuan(Number(r.netProfitFen) || 0), overrun ? `超额${fenToYuan(Number(overrun.overrunFen))}` : '-'];
    });
    const csv = '\uFEFF' + [header, ...rows].map((r) => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `经营分析-地市指标-${filterMonth ?? '累计'}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  const onRecalc = () => {
    Modal.confirm({
      title: '全库重算汇总',
      content: '将按明细重新生成全部汇总（含二次确认）。确定执行？',
      okText: '确认重算',
      onOk: async () => {
        await bizAggregateRecalc({}, true);
        message.success('全库重算完成');
        void load();
      },
    });
  };

  const onCheck = async () => {
    const r = await bizAggregateCheck();
    setCheckResult(r);
    if (r.warningCount === 0) message.success('一致性核对通过：无警告');
    else message.warning(`一致性核对发现 ${r.warningCount} 条警告（不自动改写数据）`);
  };

  const cards = [
    { label: '订单完工（元）', value: overview?.orderCompletionFen ?? 0, color: '#2878b8' },
    { label: '线下完工（元）', value: overview?.offlineCompletionFen ?? 0, color: '#0F766E' },
    { label: '毛利（元）', value: overview?.grossProfitFen ?? 0, color: '#2f9e62' },
    { label: '成本（元）', value: overview?.costFen ?? 0, color: '#c47b20' },
    { label: '净利（元）', value: overview?.netProfitFen ?? 0, color: (overview?.netProfitFen ?? 0) >= 0 ? '#2f9e62' : '#c64b4b' },
  ];

  return (
    <div style={{ padding: 24, background: '#F5F7F8', minHeight: '100vh' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>经营分析</Title>
          <Text type="secondary">汇总口径：订单+线下完工-作废 · 利润 = 毛利 - 成本</Text>
        </div>
        <Space wrap>
          <Button onClick={() => navigate('/biz/operation')}>返回经营管理</Button>
          <Button onClick={onCheck}>一致性核对</Button>
          <Button danger onClick={onRecalc}>全库重算</Button>
          <Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button>
        </Space>
      </div>

      <Row gutter={12} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={12} lg={4}>
          <Card size="small">
            <div style={{ color: '#68737B', fontSize: 12 }}>合同数量</div>
            <div style={{ fontSize: 18, fontWeight: 600, color: '#2878b8' }}>{overview?.contractCount ?? 0}</div>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={4}>
          <Card size="small">
            <div style={{ color: '#68737B', fontSize: 12 }}>总合同额（元）</div>
            <div style={{ fontSize: 18, fontWeight: 600, color: '#2878b8' }}>{fenToYuan(overview?.totalContractAmountFen ?? 0)}</div>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={4}>
          <Card size="small">
            <div style={{ color: '#68737B', fontSize: 12 }}>总完工（元）</div>
            <div style={{ fontSize: 18, fontWeight: 600, color: '#0F766E' }}>{fenToYuan(overview?.totalCompletionFen ?? 0)}</div>
          </Card>
        </Col>
        {cards.map((c) => (
          <Col xs={24} sm={12} lg={4} key={c.label}>
            <Card size="small">
              <div style={{ color: '#68737B', fontSize: 12 }}>{c.label}</div>
              <div style={{ fontSize: 18, fontWeight: 600, color: c.color }}>{fenToYuan(c.value)}</div>
            </Card>
          </Col>
        ))}
        <Col xs={24} sm={12} lg={4}>
          <Card size="small">
            <div style={{ color: '#68737B', fontSize: 12 }}>一致性警告</div>
            <div style={{ fontSize: 18, fontWeight: 600, color: checkResult && checkResult.warningCount > 0 ? '#c64b4b' : '#2f9e62' }}>
              {checkResult ? checkResult.warningCount : '-'}
            </div>
          </Card>
        </Col>
      </Row>

      {overruns.length > 0 && (
        <Card size="small" title="超额提醒" style={{ marginBottom: 16, borderLeft: '3px solid #c64b4b' }}>
          <Space wrap>
            {overruns.slice(0, 8).map((o, i) => (
              <Tag key={i} color={o.type === 'contract' ? 'red' : 'orange'}>
                {o.type === 'contract' ? `合同 ${String(o.contractNo ?? o.id ?? '').slice(0, 12)}` : `地市 ${String(o.cityId ?? '').slice(0, 8)}`} 超额 {fenToYuan(Number(o.overrunFen))}
              </Tag>
            ))}
            {overruns.length > 8 && <Text type="secondary">…共 {overruns.length} 项</Text>}
          </Space>
        </Card>
      )}

      {checkResult && checkResult.warningCount > 0 && (
        <Card size="small" title={`一致性警告（${checkResult.warningCount} 条，仅告警不自动改写）`} style={{ marginBottom: 16 }}>
          <Table scroll={{ x: "max-content" }} 
            size="small" rowKey={(r, i) => String(i)} pagination={false} dataSource={checkResult.warnings.slice(0, 20)}
            columns={[
              { title: '类型', dataIndex: 'type', key: 'type' },
              { title: '月份', dataIndex: 'month', key: 'month' },
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
                { title: '月份', dataIndex: 'month', key: 'month' },
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
            <Table scroll={{ x: "max-content" }} 
              size="small" rowKey="cityId" pagination={false} dataSource={cities}
              columns={[
                { title: '地市', dataIndex: 'cityName', key: 'cityName', render: (_: unknown, r: Record<string, unknown>) => String(r.cityName ?? r.cityId ?? '-').slice(0, 12) },
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
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card title="超额清单" size="small">
            <Table scroll={{ x: "max-content" }} 
              size="small" rowKey={(r, i) => String(i)} pagination={false} dataSource={overruns}
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
