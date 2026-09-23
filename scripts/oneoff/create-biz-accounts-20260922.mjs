/**
 * 一次性建号脚本：根据「人员账号信息表.xlsx」在 zy-pro 环境的 biz_users 中创建 17 个经营数据账号。
 *
 * 数据来源：C:/Users/lhx/Desktop/工作资料/数据库/经营数据7.29/人员账号信息表.xlsx
 * 角色映射（已与用户确认「角色最贴合」方案）：
 *   - 省级        -> admin（数据范围 all）
 *   - 合同管理员  -> contract_manager（合同域，无地理范围）
 *   - 单地市      -> city_user（绑定该地市）
 *   - 闫松(潍坊/东营/淄博) -> city_user 主绑潍坊 + 三市授权
 *   - 赵振华(河北省)      -> admin 限河北省(province 授权)
 *   - 李辉(江西省/济宁市)  -> admin 限江西省(province) + 济宁市(city) 授权
 *
 * 执行方式：后台管理 API（需 super_admin 登录）。
 *
 * 用法：
 *   BIZ_ADMIN_USERNAME=admin BIZ_ADMIN_PASSWORD=<pwd> node scripts/oneoff/create-biz-accounts-20260922.mjs
 *   node scripts/oneoff/create-biz-accounts-20260922.mjs --dry-run   # 仅打印计划，不调用接口
 *
 * 幂等：先 GET /biz/admin/users 拉取已存在账号，username 已存在则跳过。
 */

import { randomUUID } from 'node:crypto';

const BASE = process.env.BIZ_API_BASE || 'https://biz-reporting-api-315598-12-1362656322.sh.run.tcloudbase.com/api';
const DRY_RUN = process.argv.includes('--dry-run');

// ---- 库内已核对 UUID（山东省 province_id=...0030）----
const CITY = {
  菏泽市: '00000000-0000-4000-8000-000000000116',
  德州市: '00000000-0000-4000-8000-000000000113',
  临沂市: '00000000-0000-4000-8000-000000000112',
  济宁市: '00000000-0000-4000-8000-000000000108',
  枣庄市: '00000000-0000-4000-8000-000000000104',
  泰安市: '00000000-0000-4000-8000-000000000109',
  济南市: '00000000-0000-4000-8000-000000000101',
  滨州市: '00000000-0000-4000-8000-000000000115',
  潍坊市: '00000000-0000-4000-8000-000000000107',
  淄博市: '00000000-0000-4000-8000-000000000103',
  烟台市: '00000000-0000-4000-8000-000000000106',
  东营市: '00000000-0000-4000-8000-000000000105',
};
const PROV = {
  河北省: 'c965d790-2cb5-43ab-891a-a5152aa3db24',
  江西省: '3ff8ad96-c099-4104-8ffb-3795e9d473ad',
};

const INITIAL_PASSWORD = '66666666';

// ---- 账号定义（已解析角色+范围）----
const ACCOUNTS = [
  { name: '刘传锐', username: 'liucr', roleCode: 'admin', cityId: null, grants: [{ scopeType: 'all', targetId: null }] },
  { name: '张丽', username: 'zhangli', roleCode: 'admin', cityId: null, grants: [{ scopeType: 'all', targetId: null }] },
  { name: '王玉峰', username: 'wangyf', roleCode: 'city_user', cityId: CITY['菏泽市'], grants: null },
  { name: '孙康春', username: 'sunkc', roleCode: 'city_user', cityId: CITY['德州市'], grants: null },
  { name: '王锋', username: 'wangfeng', roleCode: 'city_user', cityId: CITY['临沂市'], grants: null },
  { name: '朱士军', username: 'zhusj', roleCode: 'city_user', cityId: CITY['济宁市'], grants: null },
  { name: '吴波', username: 'wubo', roleCode: 'city_user', cityId: CITY['枣庄市'], grants: null },
  {
    name: '闫松', username: 'yans', roleCode: 'city_user', cityId: CITY['潍坊市'],
    grants: [
      { scopeType: 'city', targetId: CITY['潍坊市'] },
      { scopeType: 'city', targetId: CITY['东营市'] },
      { scopeType: 'city', targetId: CITY['淄博市'] },
    ],
  },
  { name: '李晓龙', username: 'lixl', roleCode: 'city_user', cityId: CITY['泰安市'], grants: null },
  { name: '王玉馨', username: 'wangyx', roleCode: 'contract_manager', cityId: null, grants: null },
  { name: '王锶娴', username: 'wangsx', roleCode: 'contract_manager', cityId: null, grants: null },
  { name: '姜英', username: 'jiangy', roleCode: 'contract_manager', cityId: null, grants: null },
  { name: '郭珠辉', username: 'guozh', roleCode: 'city_user', cityId: CITY['济南市'], grants: null },
  { name: '赵振华', username: 'zhaozh', roleCode: 'admin', cityId: null, grants: [{ scopeType: 'province', targetId: PROV['河北省'] }] },
  {
    name: '李辉', username: 'lihui', roleCode: 'admin', cityId: null,
    grants: [
      { scopeType: 'province', targetId: PROV['江西省'] },
      { scopeType: 'city', targetId: CITY['济宁市'] },
    ],
  },
  { name: '陈明雨', username: 'chenmy', roleCode: 'city_user', cityId: CITY['烟台市'], grants: null },
  { name: '张峰', username: 'zhangf', roleCode: 'city_user', cityId: CITY['滨州市'], grants: null },
];

function scopeLabel(g) {
  if (g.scopeType === 'all') return '全部';
  if (g.scopeType === 'province') return `省:${g.targetId}`;
  if (g.scopeType === 'city') return `市:${g.targetId}`;
  return g.scopeType;
}

async function main() {
  console.log(`BASE=${BASE}  DRY_RUN=${DRY_RUN}`);
  console.log(`待创建账号数: ${ACCOUNTS.length}`);
  for (const a of ACCOUNTS) {
    const scope = a.grants ? a.grants.map(scopeLabel).join(' + ') : (a.roleCode === 'city_user' ? `市:${a.cityId}` : (a.roleCode === 'admin' ? '全部' : '合同域'));
    console.log(`  - ${a.username.padEnd(10)} ${a.name}  role=${a.roleCode.padEnd(16)} scope=[${scope}]`);
  }

  if (DRY_RUN) {
    console.log('\n[DRY-RUN] 未调用任何接口。提供 admin 密码后去掉 --dry-run 执行。');
    return;
  }

  const adminUser = process.env.BIZ_ADMIN_USERNAME;
  const adminPwd = process.env.BIZ_ADMIN_PASSWORD;
  if (!adminUser || !adminPwd) {
    console.error('缺少 BIZ_ADMIN_USERNAME / BIZ_ADMIN_PASSWORD 环境变量');
    process.exit(2);
  }

  // 1) 登录
  const loginRes = await fetch(`${BASE}/biz/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: adminUser, password: adminPwd }),
  });
  if (!loginRes.ok) {
    console.error(`登录失败 HTTP ${loginRes.status}:`, await loginRes.text());
    process.exit(2);
  }
  const { accessToken } = await loginRes.json();
  const authHeader = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
  console.log('\n[OK] 登录成功，获得 token');

  // 2) 拉取已存在账号
  const listRes = await fetch(`${BASE}/biz/admin/users`, { headers: authHeader });
  if (!listRes.ok) {
    console.error(`拉取账号列表失败 HTTP ${listRes.status}:`, await listRes.text());
    process.exit(2);
  }
  const { items: existing } = await listRes.json();
  const existingUsernames = new Set(existing.map((u) => u.username));
  const idByUsername = Object.fromEntries(existing.map((u) => [u.username, u.id]));
  console.log(`[OK] 现有账号 ${existing.length} 个`);

  let created = 0;
  let skipped = 0;
  let updated = 0;

  for (const a of ACCOUNTS) {
    if (existingUsernames.has(a.username)) {
      console.log(`  SKIP ${a.username}（已存在）`);
      skipped++;
      continue;
    }
    // 3) 创建
    const createRes = await fetch(`${BASE}/biz/admin/users`, {
      method: 'POST',
      headers: authHeader,
      body: JSON.stringify({
        username: a.username,
        password: INITIAL_PASSWORD,
        name: a.name,
        roleCode: a.roleCode,
        cityId: a.cityId,
      }),
    });
    if (!createRes.ok) {
      console.error(`  创建失败 ${a.username} HTTP ${createRes.status}:`, await createRes.text());
      continue;
    }
    const createdUser = await createRes.json();
    console.log(`  CREATED ${a.username} (${a.name}) id=${createdUser.id}`);
    created++;
    const userId = createdUser.id;

    // 4) 特殊账号：覆盖精确范围
    if (a.grants) {
      const accessRes = await fetch(`${BASE}/biz/admin/users/${userId}/access`, {
        method: 'PUT',
        headers: authHeader,
        body: JSON.stringify({ roles: [a.roleCode], grants: a.grants }),
      });
      if (!accessRes.ok) {
        console.error(`  设置范围失败 ${a.username} HTTP ${accessRes.status}:`, await accessRes.text());
        continue;
      }
      console.log(`    -> 已设置范围: ${a.grants.map(scopeLabel).join(' + ')}`);
      updated++;
    }
  }

  console.log(`\n完成：创建 ${created}，跳过(已存在) ${skipped}，其中设置范围 ${updated}。`);
}

main().catch((e) => {
  console.error('脚本异常:', e);
  process.exit(1);
});
