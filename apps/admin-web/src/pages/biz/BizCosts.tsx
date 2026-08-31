import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Alert, Button, Card, Input, InputNumber, Modal, Select, Space, Table, Tag, Typography, message } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import {
  bizAdminCities, bizAdminProvinces, bizAnalysisYears, bizCostCategories, bizCostList, bizCostReturnMonthly, bizCostSaveMonthly, bizMe,
} from '@/api/biz.api';

const { Title, Text } = Typography;
const MONTHS = Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, '0'));
const STATUS: Record<string, { label: string; color: string }> = {
  draft: { label: '草稿', color: 'default' }, pending: { label: '待处理', color: 'processing' },
  approved: { label: '已生效', color: 'success' }, rejected: { label: '已退回', color: 'error' }, voided: { label: '已作废', color: 'default' },
};
const FALLBACK_CATEGORIES = [['labor', '人工成本'], ['utilities', '水电费'], ['fuel', '油补'], ['entertainment', '招待费'], ['rent', '房租'], ['reimbursement', '报销'], ['other', '其他']];
type CostItem = Record<string, unknown>;
type EditRow = { categoryCode: string; categoryName: string; amountYuan: number | null; description: string; status?: string; id?: string };
type MatrixRow = { key: string; cityId: string; cityName: string; categoryCode: string; categoryName: string; items: Record<string, CostItem>; monthItems?: Record<string, CostItem[]>; isSubtotal?: boolean };
type CitySummaryRow = { key: string; provinceName: string; cityId: string; cityName: string; amounts: Record<string, number> };

function currentYear(): string { return String(new Date().getFullYear()); }
function currentMonth(): string { return String(new Date().getMonth() + 1).padStart(2, '0'); }
function fenToYuan(value: unknown): string { return (Number(value ?? 0) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function errorText(error: unknown): string { const detail = (error as { response?: { data?: { message?: string | string[] } } }).response?.data?.message; return Array.isArray(detail) ? detail.join('；') : (detail ?? '操作失败'); }
function statusTag(status: unknown) { const config = STATUS[String(status ?? '')]; return config ? <Tag color={config.color}>{config.label}</Tag> : null; }

export default function BizCosts() {
  const navigate = useNavigate();
  const location = useLocation();
  const [items, setItems] = useState<CostItem[]>([]);
  const [categories, setCategories] = useState<Array<{ code: string; name: string }>>([]);
  const [provinces, setProvinces] = useState<Array<{ id: string; name: string }>>([]);
  const [cities, setCities] = useState<Array<{ id: string; name: string; provinceId: string }>>([]);
  const [roleCode, setRoleCode] = useState('');
  const [permissions, setPermissions] = useState<string[]>([]);
  const [boundCityId, setBoundCityId] = useState<string | null>(null);
  const [filterYear, setFilterYear] = useState(currentYear);
  const [years, setYears] = useState<string[]>([]);
  const [filterMonths, setFilterMonths] = useState<string[]>([]);
  const [filterProvinces, setFilterProvinces] = useState<string[]>([]);
  const [filterCities, setFilterCities] = useState<string[]>([]);
  const [filterCategories, setFilterCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [editCity, setEditCity] = useState<string>();
  const [editProvince, setEditProvince] = useState<string>();
  const [editMonth, setEditMonth] = useState(`${currentYear()}-${currentMonth()}`);
  const [editRows, setEditRows] = useState<EditRow[]>([]);
  const [editLoading, setEditLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [returnTarget, setReturnTarget] = useState<{ cityId: string; month: string } | null>(null);
  const [returnComment, setReturnComment] = useState('');
  const [returning, setReturning] = useState(false);
  const isCityUser = roleCode === 'city_user';
  const canReturn = !isCityUser && (roleCode === 'super_admin' || permissions.includes('operation.cost.reject'));

  const loadItems = useCallback(async () => {
    if (!roleCode) return;
    setLoading(true);
    try {
      const result = await bizCostList({ year: filterYear, ...(isCityUser && boundCityId ? { cityId: boundCityId } : {}) });
      setItems(result.items.filter((item) => (!filterMonths.length || filterMonths.includes(String(item.businessMonth).slice(5, 7))) && (!filterCities.length || filterCities.includes(String(item.cityId))) && (!filterCategories.length || filterCategories.includes(String(item.categoryCode))) && (!filterProvinces.length || filterProvinces.includes(String(cities.find((city) => city.id === String(item.cityId))?.provinceId ?? '')))));
    } catch (error) { message.error(errorText(error)); } finally { setLoading(false); }
  }, [boundCityId, filterCategories, filterCities, filterMonths, filterProvinces, filterYear, isCityUser, roleCode, cities]);

  const loadEditRows = useCallback(async () => {
    if (!editCity || !editMonth || !categories.length) { setEditRows([]); return; }
    setEditLoading(true);
    try {
      const result = await bizCostList({ cityId: editCity, businessMonth: editMonth });
      const existing = new Map(result.items.map((item) => [String(item.categoryCode), item]));
      setEditRows(categories.map((category) => {
        const item = existing.get(category.code);
        return { id: item ? String(item.id) : undefined, categoryCode: category.code, categoryName: category.name, amountYuan: item ? Number(item.amountFen ?? 0) / 100 : null, description: String(item?.description ?? ''), status: item ? String(item.status) : undefined };
      }));
    } catch (error) { message.error(errorText(error)); setEditRows([]); } finally { setEditLoading(false); }
  }, [categories, editCity, editMonth]);

  useEffect(() => {
    void (async () => {
      try {
        const me = await bizMe(); const yearResult = await bizAnalysisYears(); setYears([...new Set([currentYear(), ...(yearResult.items ?? [])])].sort().reverse()); setRoleCode(me.roleCode); setPermissions(me.permissions); setBoundCityId(me.cityId);
        if (me.roleCode === 'city_user') setEditCity(me.cityId ?? undefined);
        else {
          const [provinceResult, cityResult] = await Promise.all([bizAdminProvinces(), bizAdminCities()]);
          setProvinces(provinceResult.items.map((item) => ({ id: String(item.id), name: String(item.name) })));
          setCities(cityResult.items.map((item) => ({ id: String(item.id), name: String(item.name), provinceId: String(item.provinceId) })));
        }
        const categoryResult = await bizCostCategories();
        setCategories(categoryResult.items.filter((item) => item.status === 'active').map((item) => ({ code: item.code, name: item.name })));
      } catch (error) { message.error(errorText(error)); }
    })();
  }, []);
  useEffect(() => {
    const cityFromLink = new URLSearchParams(location.search).get('cityId');
    if (cityFromLink) setFilterCities([cityFromLink]);
  }, [location.search]);
  useEffect(() => { void loadItems(); }, [loadItems]);
  useEffect(() => { void loadEditRows(); }, [loadEditRows]);

  const availableCities = useMemo(() => cities.filter((city) => !filterProvinces.length || filterProvinces.includes(city.provinceId)), [cities, filterProvinces]);
  const matrixRows = useMemo<MatrixRow[]>(() => {
    const categoryNames = new Map(categories.map((category) => [category.code, category.name]));
    const groups = new Map<string, MatrixRow>();
    for (const item of items) {
      const cityId = String(item.cityId ?? ''); const categoryCode = String(item.categoryCode ?? ''); const key = `${cityId}:${categoryCode}`;
      const row = groups.get(key) ?? { key, cityId, cityName: String(item.cityName ?? cities.find((city) => city.id === cityId)?.name ?? cityId), categoryCode, categoryName: categoryNames.get(categoryCode) ?? categoryCode, items: {} };
      row.items[String(item.businessMonth).slice(5, 7)] = item; groups.set(key, row);
    }
    const byCity = new Map<string, MatrixRow[]>();
    for (const row of groups.values()) (byCity.get(row.cityId) ?? (byCity.set(row.cityId, []), byCity.get(row.cityId)!)).push(row);
    const result: MatrixRow[] = [];
    for (const cityRows of [...byCity.values()].sort((left, right) => left[0].cityName.localeCompare(right[0].cityName, 'zh-CN'))) {
      cityRows.sort((left, right) => left.categoryName.localeCompare(right.categoryName, 'zh-CN'));
      result.push(...cityRows);
      const totals: Record<string, CostItem> = {};
      const monthItems: Record<string, CostItem[]> = {};
      for (const month of MONTHS) {
        const monthRows = cityRows.map((row) => row.items[month]).filter((item): item is CostItem => Boolean(item));
        const amountFen = monthRows.reduce((total, item) => total + Number(item.amountFen ?? 0), 0);
        monthItems[month] = monthRows;
        if (amountFen > 0) totals[month] = { amountFen, status: 'approved' };
      }
      result.push({ key: `${cityRows[0].cityId}:__subtotal`, cityId: cityRows[0].cityId, cityName: cityRows[0].cityName, categoryCode: '__subtotal', categoryName: '月合计', items: totals, monthItems, isSubtotal: true });
    }
    return result;
  }, [categories, cities, items]);
  const visibleMonths = filterMonths.length ? filterMonths : MONTHS;
  const citySummaries = useMemo<CitySummaryRow[]>(() => {
    const grouped = new Map<string, CitySummaryRow>();
    for (const item of items.filter((entry) => String(entry.status) === 'approved')) {
      const cityId = String(item.cityId ?? ''); const city = cities.find((entry) => entry.id === cityId);
      const row = grouped.get(cityId) ?? { key: cityId, provinceName: provinces.find((entry) => entry.id === city?.provinceId)?.name ?? '-', cityId, cityName: String(item.cityName ?? city?.name ?? cityId), amounts: {} };
      const category = String(item.categoryCode ?? ''); row.amounts[category] = (row.amounts[category] ?? 0) + Number(item.amountFen ?? 0); grouped.set(cityId, row);
    }
    return [...grouped.values()].sort((left, right) => `${left.provinceName}${left.cityName}`.localeCompare(`${right.provinceName}${right.cityName}`, 'zh-CN'));
  }, [cities, items, provinces]);
  const updateEditRow = (index: number, patch: Partial<EditRow>) => setEditRows((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));

  const saveEditRows = async (submit: boolean) => {
    if (!editCity) { message.warning('请选择填报地市'); return; }
    setSaving(true);
    try {
      await bizCostSaveMonthly({ cityId: editCity, businessMonth: editMonth, submit, entries: editRows.map((row) => ({ categoryCode: row.categoryCode, amountFen: Math.round(Number(row.amountYuan ?? 0) * 100), description: row.description })) });
      message.success(submit ? '成本已提交并立即生效' : '成本草稿已保存');
      await Promise.all([loadItems(), loadEditRows()]);
    } catch (error) { message.error(errorText(error)); } finally { setSaving(false); }
  };
  const returnMonth = (row: MatrixRow, month: string) => {
    setReturnTarget({ cityId: row.cityId, month });
    setReturnComment('');
  };
  const confirmReturnMonth = async () => {
    if (!returnTarget) return;
    if (!returnComment.trim()) { message.warning('退回原因必填'); return; }
    setReturning(true);
    try {
      await bizCostReturnMonthly({ cityId: returnTarget.cityId, businessMonth: `${filterYear}-${returnTarget.month}`, comment: returnComment.trim() });
      message.success('该地市该月份成本已全部退回，地市可修改后重新提交');
      setReturnTarget(null);
      await loadItems(); await loadEditRows();
    } catch (error) { message.error(errorText(error)); } finally { setReturning(false); }
  };

  const columns = [
    ...(!isCityUser ? [{ title: '省份', key: 'provinceName', width: 110, render: (_: unknown, row: MatrixRow) => provinces.find((province) => province.id === cities.find((city) => city.id === row.cityId)?.provinceId)?.name ?? '-' }, { title: '地市', dataIndex: 'cityName', key: 'cityName', width: 110 }] : []),
    { title: '成本类别', dataIndex: 'categoryName', key: 'categoryName', width: 130 },
    ...visibleMonths.map((month) => ({ title: `${Number(month)}月`, key: month, width: 130, render: (_: unknown, row: MatrixRow) => { const item = row.items[month]; if (!item) return <Text type="secondary">0.00</Text>; if (row.isSubtotal) { const monthItems = row.monthItems?.[month] ?? []; const hasEffective = monthItems.some((entry) => String(entry.status) === 'approved'); return <Space direction="vertical" size={0}><Text strong>{fenToYuan(item.amountFen)}</Text>{canReturn && hasEffective && <Button type="link" danger size="small" onClick={() => void returnMonth(row, month)}>整月退回</Button>}</Space>; } return <Space direction="vertical" size={0}><Text>{fenToYuan(item.amountFen)}</Text>{statusTag(item.status)}</Space>; } })),
  ];
  const editColumns = [
    { title: '成本类别', dataIndex: 'categoryName', key: 'categoryName', width: 150 },
    { title: '金额（元）', key: 'amountYuan', width: 180, render: (_: unknown, row: EditRow, index: number) => <InputNumber min={0} precision={2} value={row.amountYuan ?? undefined} onChange={(value) => updateEditRow(index, { amountYuan: value })} disabled={Boolean(row.status && !['draft', 'rejected'].includes(row.status))} style={{ width: '100%' }} /> },
    { title: '说明', key: 'description', render: (_: unknown, row: EditRow, index: number) => <Input value={row.description} onChange={(event) => updateEditRow(index, { description: event.target.value })} disabled={Boolean(row.status && !['draft', 'rejected'].includes(row.status))} /> },
    { title: '状态', key: 'status', width: 110, render: (_: unknown, row: EditRow) => row.status ? statusTag(row.status) : <Text type="secondary">待填报</Text> },
  ];

  return <div className="v3-content">
    <div className="v3-page-head"><div className="v3-page-titles"><Title level={4} style={{ margin: 0 }}>地市成本</Title></div><Space wrap><Button onClick={() => navigate('/biz/portal')}>门户首页</Button><Button icon={<ReloadOutlined />} onClick={() => { void loadItems(); void loadEditRows(); }}>刷新</Button></Space></div>
    <Card size="small" style={{ marginBottom: 16 }}><Space wrap>
      <Select value={filterYear} onChange={setFilterYear} options={years.map((year) => ({ value: year, label: `${year}年` }))} style={{ width: 120 }} />
      <Select mode="multiple" maxTagCount="responsive" allowClear placeholder="可多选月份" value={filterMonths} onChange={setFilterMonths} options={MONTHS.map((month) => ({ value: month, label: `${Number(month)}月` }))} style={{ width: 220 }} />
      {!isCityUser && <Select mode="multiple" maxTagCount="responsive" allowClear placeholder="可多选省份" value={filterProvinces} onChange={(value) => { setFilterProvinces(value); setFilterCities([]); }} options={provinces.map((province) => ({ value: province.id, label: province.name }))} style={{ width: 220 }} />}
      {!isCityUser && <Select mode="multiple" maxTagCount="responsive" allowClear placeholder="可多选地市" value={filterCities} onChange={setFilterCities} options={availableCities.map((city) => ({ value: city.id, label: city.name }))} style={{ width: 260 }} />}
      <Select mode="multiple" maxTagCount="responsive" allowClear placeholder="可多选成本类别" value={filterCategories} onChange={setFilterCategories} options={(categories.length ? categories : FALLBACK_CATEGORIES.map(([code, name]) => ({ code, name }))).map((category) => ({ value: category.code, label: category.name }))} style={{ width: 220 }} />
    </Space></Card>
    <Card size="small" title={`${filterYear} 年地市成本汇总`} loading={loading}><Table size="small" bordered scroll={{ x: 'max-content' }} rowKey="key" dataSource={citySummaries} pagination={{ pageSize: 50 }} locale={{ emptyText: '暂无已生效成本' }} columns={[{ title: '省份', dataIndex: 'provinceName', fixed: 'left' }, { title: '地市', dataIndex: 'cityName', fixed: 'left', render: (value: string, row: CitySummaryRow) => <Button type="link" size="small" onClick={() => { setFilterCities([row.cityId]); setEditCity(row.cityId); }}>{value}</Button> }, ...[['reimbursement', '报销'], ['rent', '房租'], ['labor', '人工成本'], ['utilities', '水电费'], ['fuel', '油补'], ['entertainment', '招待费']].map(([code, title]) => ({ title, key: code, render: (_: unknown, row: CitySummaryRow) => fenToYuan(row.amounts[code] ?? 0) }))]} /></Card>
    <Card size="small" title={`${filterYear} 年成本明细`} loading={loading} style={{ marginTop: 16 }}><Table size="small" bordered scroll={{ x: 900 }} rowKey="key" columns={columns} dataSource={matrixRows} pagination={{ pageSize: 50 }} locale={{ emptyText: '暂无成本数据' }} /></Card>
    <Card size="small" title="成本填报" style={{ marginTop: 16 }} extra={<Space wrap>{!isCityUser && <><Select allowClear placeholder="选择省份" value={editProvince} onChange={(value) => { setEditProvince(value); setEditCity(undefined); }} options={provinces.map((province) => ({ value: province.id, label: province.name }))} style={{ width: 150 }} /><Select allowClear placeholder="选择地市" value={editCity} onChange={setEditCity} options={cities.filter((city) => !editProvince || city.provinceId === editProvince).map((city) => ({ value: city.id, label: city.name }))} style={{ width: 150 }} /></>}<Input type="month" value={editMonth} onChange={(event) => setEditMonth(event.target.value)} style={{ width: 150 }} /></Space>}>
      {isCityUser && <Alert type="info" showIcon message="当前账号只能填报和查看本地市成本" style={{ marginBottom: 12 }} />}
      {!isCityUser && !editCity ? <Text type="secondary">请选择地市后填报成本。</Text> : <><Table size="small" bordered loading={editLoading} rowKey="categoryCode" pagination={false} columns={editColumns} dataSource={editRows} /><Space style={{ marginTop: 12 }}><Button loading={saving} onClick={() => void saveEditRows(false)}>保存草稿</Button><Button type="primary" loading={saving} onClick={() => void saveEditRows(true)}>提交并生效</Button></Space></>}
    </Card>
    <Modal title="整月退回成本" open={Boolean(returnTarget)} confirmLoading={returning} okText="确认退回" cancelText="取消" onCancel={() => { if (!returning) setReturnTarget(null); }} onOk={() => void confirmReturnMonth()}>
      <Input.TextArea value={returnComment} onChange={(event) => setReturnComment(event.target.value)} placeholder="请输入退回原因" rows={4} maxLength={500} showCount />
    </Modal>
  </div>;
}
