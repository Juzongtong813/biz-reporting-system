import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Input, InputNumber, Modal, Select, Space, Table, Tag, Typography, message } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { bizAdminCities, bizMe, bizCostApprove, bizCostCategories, bizCostCreate, bizCostList, bizCostReject, bizCostSaveMonthly, bizCostSubmit, bizCostUpdate } from '@/api/biz.api';

const { Title, Text } = Typography;
const STATUS: Record<string, { label: string; color: string }> = {
  draft: { label: '草稿', color: 'default' }, pending: { label: '待审核', color: 'processing' },
  approved: { label: '已通过', color: 'success' }, rejected: { label: '已驳回', color: 'error' }, voided: { label: '已作废', color: 'default' },
};
const FALLBACK_CATEGORIES = [['labor', '人工成本'], ['utilities', '水电费'], ['fuel', '油补'], ['entertainment', '招待费'], ['rent', '房租'], ['reimbursement', '报销'], ['other', '其他']];
type MonthlyRow = { id?: string; categoryCode: string; categoryName: string; amountYuan: number | null; description: string; status?: string };
type MonthlySummary = { key: string; cityId: string; cityName?: string; businessMonth: string; categoryNames: string[]; amountFen: number; items: Array<Record<string, unknown>> };
type AnnualSummary = { key: string; cityId: string; cityName: string; year: string; amountFen: number; monthlyItems: MonthlySummary[]; status: string };

function currentMonth(): string { return new Date().toISOString().slice(0, 7); }
function currentYear(): string { return new Date().toISOString().slice(0, 4); }
function formatMonth(v: string | null | undefined): string { const m = /^(\d{4})-(\d{2})$/.exec(String(v ?? '')); return m ? `${m[1]}年${m[2]}月` : (v ?? '-'); }
function fenToYuan(fen: number | null | undefined): string { return fen == null ? '-' : (Number(fen) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function errorText(error: unknown): string { const detail = (error as { response?: { data?: { message?: string | string[] } } }).response?.data?.message; return Array.isArray(detail) ? detail.join('；') : (detail ?? '操作失败'); }
function summaryStatus(items: Array<Record<string, unknown>>): string {
  const statuses = new Set(items.map((item) => String(item.status ?? 'draft')));
  if (statuses.size === 1) return [...statuses][0];
  if (statuses.has('rejected')) return 'partial';
  if (statuses.has('pending')) return statuses.size === 1 ? 'pending' : 'partial';
  return 'partial';
}

export default function BizCosts() {
  const navigate = useNavigate();
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [cities, setCities] = useState<Array<{ id: string; name: string }>>([]);
  const [categories, setCategories] = useState<Array<{ code: string; name: string }>>([]);
  const [roleCode, setRoleCode] = useState('');
  const [permissions, setPermissions] = useState<string[]>([]);
  const [boundCityId, setBoundCityId] = useState<string | null>(null);
  const [selectedCity, setSelectedCity] = useState<string>();
  const [month, setMonth] = useState(currentMonth);
  const [filterCity, setFilterCity] = useState<string>();
  const [filterYear, setFilterYear] = useState<string | undefined>(currentYear);
  const [filterStatus, setFilterStatus] = useState<string>();
  const [expandedAnnualKeys, setExpandedAnnualKeys] = useState<string[]>([]);
  const [rows, setRows] = useState<MonthlyRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [monthlyLoading, setMonthlyLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const isCityUser = roleCode === 'city_user';
  const activeCityId = isCityUser ? boundCityId : selectedCity;

  const loadCategories = useCallback(async () => {
    try { const result = await bizCostCategories(); setCategories(result.items.filter((item) => item.status === 'active').map((item) => ({ code: item.code, name: item.name }))); }
    catch { setCategories(FALLBACK_CATEGORIES.map(([code, name]) => ({ code, name }))); }
  }, []);
  const loadList = useCallback(async () => {
    if (!roleCode || (isCityUser && !boundCityId)) return;
    setLoading(true);
    try { setItems((await bizCostList(isCityUser && boundCityId ? { cityId: boundCityId } : undefined)).items); }
    catch (error) { message.error(errorText(error)); } finally { setLoading(false); }
  }, [boundCityId, isCityUser, roleCode]);
  const loadMonthly = useCallback(async () => {
    if (!month || !categories.length || (!isCityUser && !activeCityId)) { setRows([]); return; }
    setMonthlyLoading(true);
    try {
      const result = await bizCostList({ businessMonth: month, ...(activeCityId ? { cityId: activeCityId } : {}) });
      // 旧 API 未实现 businessMonth 查询时仍可能返回全部月份，前端必须二次过滤，避免跨月记录被错误锁定。
      const existing = new Map(result.items.filter((item) => String(item.businessMonth) === month).map((item) => [String(item.categoryCode), item]));
      setRows(categories.map((category) => {
        const item = existing.get(category.code);
        return { id: item ? String(item.id) : undefined, categoryCode: category.code, categoryName: category.name, amountYuan: item ? Number(item.amountFen) / 100 : null, description: String(item?.description ?? ''), status: item ? String(item.status) : undefined };
      }));
    } catch (error) { message.error(errorText(error)); setRows([]); } finally { setMonthlyLoading(false); }
  }, [activeCityId, categories, isCityUser, month]);
  useEffect(() => { void (async () => {
    try {
      const me = await bizMe(); setRoleCode(me.roleCode); setPermissions(me.permissions); setBoundCityId(me.cityId);
      if (me.roleCode !== 'city_user') { const result = await bizAdminCities().catch(() => ({ items: [] })); setCities(result.items.map((item) => ({ id: String(item.id), name: String(item.name) }))); if (result.items.length === 1) setSelectedCity(String(result.items[0].id)); }
      await loadCategories();
    } catch (error) { message.error(errorText(error)); }
  })(); }, [loadCategories]);
  useEffect(() => { void loadList(); }, [loadList]);
  useEffect(() => { void loadMonthly(); }, [loadMonthly]);

  const updateRow = (index: number, patch: Partial<MonthlyRow>) => setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  const saveMonthly = async (submit: boolean) => {
    if (!month || (!isCityUser && !activeCityId)) { message.warning(isCityUser ? '请选择业务月份' : '请选择地市和业务月份'); return; }
    setSaving(true);
    try {
      const entries = rows.map((row) => ({ categoryCode: row.categoryCode, amountFen: Math.round(Number(row.amountYuan ?? 0) * 100), description: row.description }));
      try {
        await bizCostSaveMonthly({ cityId: activeCityId, businessMonth: month, submit, entries });
      } catch (error) {
        const status = (error as { response?: { status?: number } }).response?.status;
        if (status !== 404) throw error;
        const editableRows = rows.filter((row) => !row.status || ['draft', 'rejected'].includes(row.status)).filter((row) => Number(row.amountYuan ?? 0) > 0);
        const saved = await Promise.all(editableRows.map((row) => row.id
          ? bizCostUpdate(row.id, { amountFen: Math.round(Number(row.amountYuan) * 100), description: row.description })
          : bizCostCreate({ cityId: activeCityId ?? '', businessMonth: month, categoryCode: row.categoryCode, amountFen: Math.round(Number(row.amountYuan) * 100), description: row.description })));
        if (submit) await Promise.all(saved.map((item) => bizCostSubmit(String(item.id))));
      }
      message.success(submit ? '本月成本已提交审核' : '本月成本草稿已保存'); await loadList(); await loadMonthly();
    } catch (error) { message.error(errorText(error)); } finally { setSaving(false); }
  };
  const run = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); message.success(ok); await loadList(); await loadMonthly(); } catch (error) { message.error(errorText(error)); } };
  const categoryMap = useMemo(() => new Map(categories.map((item) => [item.code, item.name])), [categories]);
  const monthlyItems = useMemo<MonthlySummary[]>(() => {
    const groups = new Map<string, MonthlySummary>();
    for (const item of items) {
      const cityId = String(item.cityId); const businessMonth = String(item.businessMonth); const key = `${cityId}:${businessMonth}`;
      const group = groups.get(key) ?? { key, cityId, cityName: item.cityName ? String(item.cityName) : undefined, businessMonth, categoryNames: [], amountFen: 0, items: [] };
      group.items.push(item); group.amountFen += Number(item.amountFen ?? 0); group.categoryNames.push(categoryMap.get(String(item.categoryCode)) ?? String(item.categoryCode)); groups.set(key, group);
    }
    return [...groups.values()].sort((left, right) => right.businessMonth.localeCompare(left.businessMonth));
  }, [categoryMap, items]);
  const visibleMonthlyItems = useMemo(() => monthlyItems.filter((summary) => {
    const matchesCity = isCityUser || !filterCity || summary.cityId === filterCity;
    const matchesYear = !filterYear || summary.businessMonth.startsWith(`${filterYear}-`);
    const matchesStatus = !filterStatus || summary.items.some((item) => String(item.status) === filterStatus);
    return matchesCity && matchesYear && matchesStatus;
  }), [filterCity, filterStatus, filterYear, isCityUser, monthlyItems]);
  const annualItems = useMemo<AnnualSummary[]>(() => {
    const groups = new Map<string, AnnualSummary>();
    for (const summary of monthlyItems) {
      const year = summary.businessMonth.slice(0, 4);
      const cityName = summary.cityName ?? cities.find((city) => city.id === summary.cityId)?.name ?? summary.cityId;
      const key = `${summary.cityId}:${year}`;
      const group = groups.get(key) ?? { key, cityId: summary.cityId, cityName, year, amountFen: 0, monthlyItems: [], status: 'draft' };
      group.amountFen += summary.amountFen;
      group.monthlyItems.push(summary);
      group.status = summaryStatus(group.monthlyItems.flatMap((item) => item.items));
      groups.set(key, group);
    }
    return [...groups.values()].sort((left, right) => right.year.localeCompare(left.year) || left.cityName.localeCompare(right.cityName, 'zh-CN'));
  }, [cities, monthlyItems]);
  const visibleAnnualItems = useMemo(() => annualItems.filter((summary) => {
    const matchesYear = !filterYear || summary.year === filterYear;
    const matchesCity = !filterCity || summary.cityId === filterCity;
    const matchesStatus = !filterStatus || summary.status === filterStatus;
    return matchesYear && matchesCity && matchesStatus;
  }), [annualItems, filterCity, filterStatus, filterYear]);
  const submitMonth = async (summary: MonthlySummary) => {
    const drafts = summary.items.filter((item) => ['draft', 'rejected'].includes(String(item.status)));
    if (!drafts.length) { message.info('本月没有可提交的成本分类'); return; }
    await run(() => Promise.all(drafts.map((item) => bizCostSubmit(String(item.id)))), '本月成本已提交审核');
  };
  const approveMonth = async (summary: MonthlySummary) => await run(() => Promise.all(summary.items.filter((item) => String(item.status) === 'pending').map((item) => bizCostApprove(String(item.id)))), '本月成本已审核通过');
  const rejectMonth = (summary: MonthlySummary) => Modal.confirm({ title: '驳回本月成本', onOk: () => new Promise<void>((resolve, reject) => { const comment = window.prompt('驳回原因（必填）：'); if (!comment?.trim()) { message.warning('驳回原因必填'); reject(); return; } Promise.all(summary.items.filter((item) => String(item.status) === 'pending').map((item) => bizCostReject(String(item.id), comment))).then(() => { message.success('本月成本已驳回'); void loadList(); resolve(); }).catch(reject); }) });
  const canApprove = roleCode === 'super_admin' || permissions.includes('operation.cost.approve');
  const statusConfig: Record<string, { label: string; color: string }> = { ...STATUS, partial: { label: '部分完成', color: 'warning' } };
  const statusOptions = Object.entries(statusConfig).map(([value, option]) => ({ value, label: option.label }));
  const detailColumns = [
    { title: '成本分类', key: 'categoryName', render: (_: unknown, item: Record<string, unknown>) => categoryMap.get(String(item.categoryCode)) ?? String(item.categoryCode ?? '-') },
    { title: '金额（元）', key: 'amountFen', align: 'right' as const, render: (_: unknown, item: Record<string, unknown>) => fenToYuan(Number(item.amountFen ?? 0)) },
    { title: '状态', key: 'status', render: (_: unknown, item: Record<string, unknown>) => { const status = String(item.status ?? ''); return <Tag color={STATUS[status]?.color}>{STATUS[status]?.label ?? (status || '待填报')}</Tag>; } },
    { title: '审核意见', key: 'reviewComment', ellipsis: true, render: (_: unknown, item: Record<string, unknown>) => String(item.reviewComment ?? '-') },
  ];
  const monthlySummaryColumns = [
    ...(!isCityUser ? [{ title: '地市', dataIndex: 'cityName', key: 'cityName', render: (v: string, row: MonthlySummary) => v ?? cities.find((city) => city.id === row.cityId)?.name ?? '-' }] : []),
    { title: '业务月份', dataIndex: 'businessMonth', key: 'businessMonth', width: 110, render: (v: string) => formatMonth(v) },
    { title: '成本分类', key: 'categoryNames', render: (_: unknown, row: MonthlySummary) => `${row.categoryNames.length} 类` },
    { title: '金额（元）', dataIndex: 'amountFen', key: 'amountFen', render: (v: number) => fenToYuan(v) },
    { title: '状态', key: 'status', render: (_: unknown, row: MonthlySummary) => <Space size={4} wrap>{Object.entries(row.items.reduce<Record<string, number>>((result, item) => { const status = String(item.status); result[status] = (result[status] ?? 0) + 1; return result; }, {})).map(([status, count]) => <Tag key={status} color={STATUS[status]?.color}>{STATUS[status]?.label ?? status}{count > 1 ? ` ${count}项` : ''}</Tag>)}</Space> },
    { title: '审核意见', key: 'reviewComment', ellipsis: true, render: (_: unknown, row: MonthlySummary) => row.items.map((item) => String(item.reviewComment ?? '')).filter(Boolean).join('；') || '-' },
    { title: '操作', key: 'action', width: 260, render: (_: unknown, row: MonthlySummary) => <Space wrap>
      {row.items.some((item) => ['draft', 'rejected'].includes(String(item.status))) && <Button size="small" type="primary" onClick={() => void submitMonth(row)}>提交本月审核</Button>}
      {canApprove && row.items.some((item) => String(item.status) === 'pending') && <Button size="small" onClick={() => void approveMonth(row)}>通过本月</Button>}
      {canApprove && row.items.some((item) => String(item.status) === 'pending') && <Button size="small" danger onClick={() => rejectMonth(row)}>驳回本月</Button>}
    </Space> },
  ];
  const annualColumns = [
    { title: '地市', dataIndex: 'cityName', key: 'cityName' },
    { title: '年度', dataIndex: 'year', key: 'year', width: 100, render: (v: string) => `${v}年` },
    { title: '累计成本（元）', dataIndex: 'amountFen', key: 'amountFen', align: 'right' as const, render: (v: number) => fenToYuan(v) },
    { title: '状态', dataIndex: 'status', key: 'status', render: (value: string) => <Tag color={value === 'partial' ? 'warning' : STATUS[value]?.color}>{value === 'partial' ? '部分完成' : (STATUS[value]?.label ?? value)}</Tag> },
    { title: '操作', key: 'action', width: 120, render: (_: unknown, summary: AnnualSummary) => <Button type="link" size="small" onClick={(event) => { event.stopPropagation(); setExpandedAnnualKeys((keys) => keys.includes(summary.key) ? keys.filter((key) => key !== summary.key) : [...keys, summary.key]); }}>{expandedAnnualKeys.includes(summary.key) ? '收起明细' : '查看明细'}</Button> },
  ];
  const monthlyColumns = [
    { title: '成本分类', dataIndex: 'categoryName', key: 'categoryName', width: 180 },
    { title: '金额（元）', key: 'amountYuan', width: 190, render: (_: unknown, row: MonthlyRow, index: number) => <InputNumber min={0} precision={2} value={row.amountYuan ?? undefined} onChange={(value) => updateRow(index, { amountYuan: value })} style={{ width: '100%' }} disabled={Boolean(row.status && !['draft', 'rejected'].includes(row.status))} /> },
    { title: '说明', key: 'description', render: (_: unknown, row: MonthlyRow, index: number) => <Input value={row.description} onChange={(event) => updateRow(index, { description: event.target.value })} disabled={Boolean(row.status && !['draft', 'rejected'].includes(row.status))} /> },
    { title: '状态', key: 'status', width: 110, render: (_: unknown, row: MonthlyRow) => row.status ? <Tag color={STATUS[row.status]?.color}>{STATUS[row.status]?.label ?? row.status}</Tag> : <Text type="secondary">待填报</Text> },
  ];
  return <div className="v3-content">
    <div className="v3-page-head"><div className="v3-page-titles"><Title level={4} style={{ margin: 0 }}>地市成本</Title></div><Space className="v3-page-head-actions" wrap><Button onClick={() => navigate('/biz/operation')}>返回经营管理</Button><Button icon={<ReloadOutlined />} onClick={() => { void loadList(); void loadMonthly(); }}>刷新</Button></Space></div>
    <Card title="按月填报成本" extra={<Space>{!isCityUser && <Select allowClear placeholder="选择地市" value={selectedCity} onChange={setSelectedCity} options={cities.map((city) => ({ value: city.id, label: city.name }))} style={{ width: 160 }} />}<Input type="month" value={month} onChange={(event) => setMonth(event.target.value)} style={{ width: 150 }} /></Space>}>
      {!isCityUser && !activeCityId ? <Text type="secondary">请选择地市后填报本月成本。</Text> : <><Table rowKey="categoryCode" loading={monthlyLoading} columns={monthlyColumns} dataSource={rows} pagination={false} /><Space style={{ marginTop: 16 }}><Button type="primary" loading={saving} onClick={() => void saveMonthly(false)}>保存本月草稿</Button><Button loading={saving} onClick={() => void saveMonthly(true)}>提交本月审核</Button></Space></>}
    </Card>
    <Card
      title={isCityUser ? '月度成本明细' : '年度成本总览'}
      style={{ marginTop: 16 }}
      extra={<Space wrap>
        {!isCityUser && <Select allowClear placeholder="筛选地市" value={filterCity} onChange={setFilterCity} options={cities.map((city) => ({ value: city.id, label: city.name }))} style={{ width: 140 }} />}
        <Input type="number" min={2000} max={2100} aria-label="筛选年度" placeholder="筛选年度" value={filterYear} onChange={(event) => setFilterYear(event.target.value || undefined)} style={{ width: 120 }} />
        <Select allowClear placeholder="筛选状态" value={filterStatus} onChange={setFilterStatus} options={statusOptions} style={{ width: 120 }} />
        <Button onClick={() => { setFilterCity(undefined); setFilterYear(currentYear()); setFilterStatus(undefined); }}>重置筛选</Button>
      </Space>}
    >
      {isCityUser ? <Table
        scroll={{ x: 'max-content' }}
        rowKey="key"
        loading={loading}
        columns={monthlySummaryColumns}
        dataSource={visibleMonthlyItems}
        pagination={{ pageSize: 10 }}
        expandable={{ expandedRowRender: (summary) => <Table size="small" rowKey={(item) => String(item.id ?? item.categoryCode)} columns={detailColumns} dataSource={summary.items} pagination={false} /> }}
      /> : <Table
        scroll={{ x: 'max-content' }}
        rowKey="key"
        loading={loading}
        columns={annualColumns}
        dataSource={visibleAnnualItems}
        pagination={{ pageSize: 10 }}
        expandable={{ expandedRowKeys: expandedAnnualKeys, onExpand: (expanded, summary) => setExpandedAnnualKeys((keys) => expanded ? [...keys, summary.key] : keys.filter((key) => key !== summary.key)), expandedRowRender: (annual) => <Table size="small" rowKey="key" columns={monthlySummaryColumns} dataSource={annual.monthlyItems} pagination={false} expandable={{ expandedRowRender: (summary) => <Table size="small" rowKey={(item) => String(item.id ?? item.categoryCode)} columns={detailColumns} dataSource={summary.items} pagination={false} /> }} /> }}
      />}
    </Card>
  </div>;
}
