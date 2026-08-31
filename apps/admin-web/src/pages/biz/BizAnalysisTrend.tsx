import { useCallback, useEffect, useState } from 'react';
import { Card, Space, Typography, message } from 'antd';
import ReactECharts from 'echarts-for-react';
import { bizSnapshotDashboard, type BizDashboardResult } from '@/api/biz.api';
import { BizAnalysisFilter, EMPTY_ANALYSIS_FILTER, type AnalysisFilterValue } from '@/components/biz/BizAnalysisFilter';
const { Title } = Typography;

/** 金额（分）→ 元 */
function fenToYuan(value: number | null | undefined): number {
  return Number(value ?? 0) / 100;
}

/** 坐标轴金额缩写：亿 / 万 / 原值 */
function formatAxis(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e8) return `${(value / 1e8).toFixed(2)}亿`;
  if (abs >= 1e4) return `${(value / 1e4).toFixed(1)}万`;
  return String(value);
}

export default function BizAnalysisTrend() {
  const [filter, setFilter] = useState<AnalysisFilterValue>(EMPTY_ANALYSIS_FILTER);
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);

  const load = useCallback(async () => {
    try {
      const dashboard = await bizSnapshotDashboard({
        year: filter.year || undefined,
        months: filter.months,
        provinceIds: filter.provinceIds,
        cityIds: filter.cityIds,
      });
      const d = dashboard as BizDashboardResult;
      setItems((d.trend.items as Array<Record<string, unknown>>) ?? []);
    } catch {
      message.error('趋势数据加载失败');
    }
  }, [filter]);

  useEffect(() => { void load(); }, [load]);

  // 以选定年度构造 12 个月横轴；后端按月聚合，缺失月份补 0（保证每年恒为 12 个点）
  const months = filter.year
    ? Array.from({ length: 12 }, (_, index) => `${filter.year}-${String(index + 1).padStart(2, '0')}`).filter((month) => !filter.months.length || filter.months.includes(month))
    : [];
  const byMonth = new Map(items.map((it) => [String(it.month), it]));
  const toSeries = (key: string) => months.map((m) => fenToYuan(byMonth.get(m)?.[key] as number | undefined));

  // 以 any 透传 echarts option，避免与 echarts 严格类型定义（tooltip.valueFormatter 等回调签名）冲突
  const option: any = {
    tooltip: {
      trigger: 'axis',
      valueFormatter: (v: number) => `${(Number(v) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 元`,
    },
    legend: { data: ['订单完工', '线下完工', '毛利', '净利'], top: 0 },
    grid: { left: 72, right: 28, top: 40, bottom: 36 },
    xAxis: { type: 'category', boundaryGap: false, data: months.map((m) => `${m.slice(5, 7)}月`), name: '月份' },
    yAxis: { type: 'value', name: '金额（元）', axisLabel: { formatter: (v: number) => formatAxis(v) } },
    series: [
      { name: '订单完工', type: 'line', smooth: true, showSymbol: true, data: toSeries('orderCompletionFen') },
      { name: '线下完工', type: 'line', smooth: true, showSymbol: true, data: toSeries('offlineCompletionFen') },
      { name: '毛利', type: 'line', smooth: true, showSymbol: true, data: toSeries('grossProfitFen') },
      { name: '净利', type: 'line', smooth: true, showSymbol: true, areaStyle: { opacity: 0.08 }, data: toSeries('netProfitFen') },
    ],
  };

  return (
    <div className="v3-content">
      <div className="v3-page-head">
        <div className="v3-page-titles"><Title level={4} style={{ margin: 0 }}>月度趋势</Title><Typography.Text type="secondary">{filter.year ? `${filter.year}年度` : '全部期间'}</Typography.Text></div>
        <Space wrap />
      </div>
      <BizAnalysisFilter value={filter} onChange={setFilter} />
      <Card size="small" style={{ marginTop: 12 }} title={filter.year ? `${filter.year}年月度经营趋势` : '月度经营趋势'}>
        {months.length ? (
          <ReactECharts option={option} style={{ height: 380, width: '100%' }} notMerge lazyUpdate opts={{ renderer: 'canvas' }} />
        ) : (
          <div style={{ textAlign: 'center', padding: 48, color: '#999' }}>请选择年度后查看趋势</div>
        )}
      </Card>
    </div>
  );
}
