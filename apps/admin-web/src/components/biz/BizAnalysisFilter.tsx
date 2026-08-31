import { useEffect, useState } from 'react';
import { Select, Space } from 'antd';
import { bizAdminCities, bizAdminProvinces, bizAnalysisYears } from '@/api/biz.api';

/** 统一分析筛选值：年度 + 多月 + 多省份 + 多地市（与后端 dashboard / 合同台账接口参数一致） */
export interface AnalysisFilterValue {
  year: string;
  months: string[];
  provinceIds: string[];
  cityIds: string[];
}

export const EMPTY_ANALYSIS_FILTER: AnalysisFilterValue = { year: '', months: [], provinceIds: [], cityIds: [] };

interface Props {
  value: AnalysisFilterValue;
  onChange: (value: AnalysisFilterValue) => void;
  /** 是否展示"月份"多选（趋势/概览/单位对比/超额均需要；个别页可隐藏） */
  showMonths?: boolean;
}

/**
 * 经营分析统一筛选条：年度 / 多月 / 多省份 / 多地市。
 *  - 年度选项来自 biz_analysis/years（即 biz_order_rows.business_month 去重，按用户数据范围过滤，最新年在前）；
 *    默认年度取最新数据年度，无有效订单时为空（不回退当年）。
 *  - 省/市为联动多选，选省份会清空已选地市。
 *  - 受控组件：仅通过 value/onChange 与父组件通信，自身负责拉取选项列表。
 */
export function BizAnalysisFilter({ value, onChange, showMonths = true }: Props) {
  const [years, setYears] = useState<string[]>([]);
  const [provinces, setProvinces] = useState<Array<{ id: string; name: string }>>([]);
  const [cities, setCities] = useState<Array<{ id: string; name: string; provinceId: string }>>([]);

  useEffect(() => {
    void (async () => {
      const [yr, pr, ci] = await Promise.all([bizAnalysisYears(), bizAdminProvinces(), bizAdminCities()]);
      const items = (yr.items ?? []).map(String);
      setYears(items);
      setProvinces((pr.items ?? []).map((p) => ({ id: p.id, name: p.name })));
      setCities((ci.items ?? []).map((c) => ({ id: c.id, name: c.name, provinceId: c.provinceId })));
      // 默认年度取最新数据年度（无有效订单则为空，不回退当年）
      if (!value.year && items.length) onChange({ ...value, year: items[0] });
    })();
    // 仅挂载时拉一次；默认年度设置依赖初始 value，刻意不加入依赖避免重复触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const monthOptions = value.year
    ? Array.from({ length: 12 }, (_, index) => `${value.year}-${String(index + 1).padStart(2, '0')}`)
    : [];

  return (
    <Space wrap>
      <Select
        value={value.year || undefined}
        style={{ width: 120 }}
        placeholder="年度"
        options={years.map((y) => ({ value: y, label: `${y}年` }))}
        onChange={(year) => onChange({ ...value, year, months: [] })}
      />
      {showMonths && (
        <Select
          mode="multiple" maxTagCount="responsive" allowClear
          value={value.months} placeholder="可多选月份" style={{ width: 220 }}
          options={monthOptions.map((m) => ({ value: m, label: `${m.slice(5, 7)}月` }))}
          onChange={(months) => onChange({ ...value, months })}
        />
      )}
      <Select
        mode="multiple" maxTagCount="responsive" allowClear
        value={value.provinceIds} placeholder="可多选省份" style={{ width: 220 }}
        options={provinces.map((p) => ({ value: p.id, label: p.name }))}
        onChange={(provinceIds) => onChange({ ...value, provinceIds, cityIds: [] })}
      />
      <Select
        mode="multiple" maxTagCount="responsive" allowClear
        value={value.cityIds} placeholder="可多选地市" style={{ width: 260 }}
        options={cities.filter((c) => !value.provinceIds.length || value.provinceIds.includes(c.provinceId)).map((c) => ({ value: c.id, label: c.name }))}
        onChange={(cityIds) => onChange({ ...value, cityIds })}
      />
    </Space>
  );
}
