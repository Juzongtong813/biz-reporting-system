import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { bizAdminCities, bizAdminProvinces, bizAnalysisYears } from '@/api/biz.api';

/**
 * 经营分析共享筛选项（年度 / 省份 / 地市）全局缓存。
 *
 * 背景：概览、月度趋势、地市对比、超额清单、地市成本都会用到同一批选项数据，
 * 原先每个页面各自在挂载时拉取一次，切换页面即重复请求 3 个接口。
 *
 * 设计：
 *  - 模块级 cache + inflight Promise：整个应用生命周期内只发一次请求，
 *    并发挂载的多个组件共享同一个 inflight Promise，不会重复打接口；
 *  - Context 仅负责把已就绪的数据广播给消费方，并暴露 loading / error 状态；
 *  - 只缓存字典类选项，不缓存任何业务数据，权限过滤仍由后端按 auth.dataScope 执行。
 */
export interface AnalysisOptionProvince {
  id: string;
  name: string;
}

export interface AnalysisOptionCity {
  id: string;
  name: string;
  provinceId: string;
}

export interface AnalysisOptionsState {
  years: string[];
  provinces: AnalysisOptionProvince[];
  cities: AnalysisOptionCity[];
  loading: boolean;
  error: string | null;
}

type CachedOptions = Pick<AnalysisOptionsState, 'years' | 'provinces' | 'cities'>;

const EMPTY_STATE: AnalysisOptionsState = { years: [], provinces: [], cities: [], loading: true, error: null };
const OptionsContext = createContext<AnalysisOptionsState>(EMPTY_STATE);

let cache: CachedOptions | null = null;
let inflight: Promise<CachedOptions> | null = null;

/** 拉取（并缓存）选项；并发调用共享同一个 inflight Promise */
function fetchOptions(): Promise<CachedOptions> {
  if (!inflight) {
    inflight = Promise.all([bizAnalysisYears(), bizAdminProvinces(), bizAdminCities()])
      .then(([yearResult, provinceResult, cityResult]) => ({
        years: (yearResult.items ?? []).map(String),
        provinces: (provinceResult.items ?? []).map((p) => ({ id: p.id, name: p.name })) as AnalysisOptionProvince[],
        cities: (cityResult.items ?? []).map((c) => ({ id: c.id, name: c.name, provinceId: c.provinceId })) as AnalysisOptionCity[],
      }))
      .catch((error: unknown) => {
        // 失败时清空 inflight，允许后续重试
        inflight = null;
        throw error;
      });
  }
  return inflight;
}

export function BizAnalysisOptionsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AnalysisOptionsState>(cache ? { ...cache, loading: false, error: null } : EMPTY_STATE);

  useEffect(() => {
    let active = true;
    if (cache) {
      setState({ ...cache, loading: false, error: null });
      return;
    }
    setState((prev) => ({ ...prev, loading: true, error: null }));
    fetchOptions()
      .then((data) => {
        cache = data;
        if (active) setState({ ...data, loading: false, error: null });
      })
      .catch(() => {
        if (active) setState({ years: [], provinces: [], cities: [], loading: false, error: '筛选选项加载失败，请刷新重试' });
      });
    return () => {
      active = false;
    };
  }, []);

  return <OptionsContext.Provider value={state}>{children}</OptionsContext.Provider>;
}

export function useBizAnalysisOptions(): AnalysisOptionsState {
  return useContext(OptionsContext);
}
