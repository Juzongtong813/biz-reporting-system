import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Space, Table, Typography, message } from 'antd';
import { useNavigate } from 'react-router-dom';
import { bizSnapshotDashboard, type BizDashboardResult } from '@/api/biz.api';
import { BizAnalysisFilter, EMPTY_ANALYSIS_FILTER, type AnalysisFilterValue } from '@/components/biz/BizAnalysisFilter';
const { Title } = Typography;
function fenToYuan(value: number): string { return (Number(value || 0) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

export default function BizAnalysisCities() {
  const navigate = useNavigate();
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
      // dashboard 已按省/市范围交集过滤，无需前端二次过滤
      setItems((d.byCity.items as Array<Record<string, unknown>>) ?? []);
    } catch {
      message.error('经营单位对比加载失败');
    }
  }, [filter]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="v3-content">
      <div className="v3-page-head"><div className="v3-page-titles"><Title level={4} style={{ margin: 0 }}>经营单位对比</Title></div><Space wrap /></div>
      <BizAnalysisFilter value={filter} onChange={setFilter} />
      <Card size="small" style={{ marginTop: 12 }} title="经营单位指标对比">
        <Table scroll={{ x: 'max-content' }} size="small" rowKey="cityId" pagination={{ pageSize: 20 }} dataSource={items} locale={{ emptyText: '暂无数据' }} columns={[
          { title: '省份', dataIndex: 'provinceName', key: 'province', fixed: 'left' },
          { title: '经营单位', dataIndex: 'cityName', key: 'city', fixed: 'left', render: (value: string, row: Record<string, unknown>) => <Button type="link" size="small" onClick={() => navigate(`/biz/analysis/city/${encodeURIComponent(String(row.cityId))}`)}>{value}{row.unitType === 'province_branch' ? '（省级直属）' : ''}</Button> },
          { title: '合同数', dataIndex: 'contractCount' },
          { title: '合同额（元）', dataIndex: 'contractAmountFen', render: (value: number) => fenToYuan(value) },
          { title: '订单完工（元）', dataIndex: 'orderCompletionFen', render: (value: number) => fenToYuan(value) },
          { title: '线下完工（元）', dataIndex: 'offlineCompletionFen', render: (value: number) => fenToYuan(value) },
          { title: '累计完工（元）', dataIndex: 'completionFen', render: (value: number) => fenToYuan(value) },
          { title: '毛利（元）', dataIndex: 'grossProfitFen', render: (value: number) => fenToYuan(value) },
          { title: '净利（元）', dataIndex: 'netProfitFen', render: (value: number) => fenToYuan(value) },
        ]} />
      </Card>
    </div>
  );
}
