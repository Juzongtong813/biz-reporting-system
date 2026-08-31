import { useCallback, useEffect, useState } from 'react';
import { Card, Space, Table, Tag, Typography, message } from 'antd';
import { bizSnapshotDashboard, type BizDashboardResult } from '@/api/biz.api';
import { BizAnalysisFilter, EMPTY_ANALYSIS_FILTER, type AnalysisFilterValue } from '@/components/biz/BizAnalysisFilter';
const { Title } = Typography;
function fenToYuan(value: number): string { return (Number(value || 0) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

export default function BizAnalysisOverruns() {
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
      // dashboard 已按 year/month/province/city 交集过滤超额，无需前端二次过滤
      setItems((d.overruns.items as Array<Record<string, unknown>>) ?? []);
    } catch {
      message.error('超额清单加载失败');
    }
  }, [filter]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="v3-content">
      <div className="v3-page-head"><div className="v3-page-titles"><Title level={4} style={{ margin: 0 }}>超额清单</Title></div><Space wrap /></div>
      <BizAnalysisFilter value={filter} onChange={setFilter} />
      <Card size="small" style={{ marginTop: 12 }} title="合同与经营单位超额">
        <Table scroll={{ x: 'max-content' }} size="small" rowKey={(row) => `${row.type}-${row.contractId ?? row.cityId}-${row.overrunFen}`} pagination={{ pageSize: 20 }} dataSource={items} locale={{ emptyText: '暂无超额数据' }} columns={[
          { title: '类型', dataIndex: 'type', render: (value: string) => value === 'contract' ? <Tag color="red">合同超额</Tag> : <Tag color="orange">经营单位超额</Tag> },
          { title: '合同/经营单位', render: (_: unknown, row: Record<string, unknown>) => String(row.contractNo ?? row.cityName ?? row.cityId ?? '-') },
          { title: '超额（元）', dataIndex: 'overrunFen', render: (value: number) => <Tag color="red">{fenToYuan(value)}</Tag> },
        ]} />
      </Card>
    </div>
  );
}
