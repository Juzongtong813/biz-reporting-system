import { useEffect, useState } from 'react';
import { bizMe } from '@/api/biz.api';

/** me 权限缓存（模块级；登录/刷新时刷新，前端仅控制展示与交互） */
let cachedPermissions: { isSuper: boolean; codes: Set<string> } | null = null;
let cacheLoadedAt = 0;
const CACHE_TTL = 60_000;

export async function loadBizPermissions(force = false): Promise<{ isSuper: boolean; codes: Set<string> }> {
  if (!force && cachedPermissions && Date.now() - cacheLoadedAt < CACHE_TTL) return cachedPermissions;
  try {
    const me = await bizMe();
    cachedPermissions = {
      isSuper: me.roleCode === 'super_admin',
      codes: new Set(me.permissions ?? []),
    };
    cacheLoadedAt = Date.now();
  } catch {
    cachedPermissions = { isSuper: false, codes: new Set() };
  }
  return cachedPermissions;
}

/** 组件内权限判断（前端展示控制；后端守卫为最终授权边界）。返回 null 表示加载中。 */
export function useBizPermission(code: string): boolean | null {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  useEffect(() => {
    void loadBizPermissions().then((p) => setAllowed(p.isSuper || p.codes.has(code)));
  }, [code]);
  return allowed;
}
