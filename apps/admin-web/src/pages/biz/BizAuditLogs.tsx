import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, DatePicker, Input, Select, Space, Table, Tag, Typography, message } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { bizAdminListUsers, bizOperationLogs } from '@/api/biz.api';
import { useBizPermission } from '@/utils/biz-permission';

const { Title, Text } = Typography;

const ROLE_LABEL: Record<string, string> = {
  admin: '省级运营管理员',
  contract_manager: '合同管理员',
  city_user: '地市用户',
};

const ACTION_LABEL: Record<string, string> = {
  'auth.login.success': '登录成功',
  'auth.login.failed': '登录失败',
};

type LogRow = Record<string, unknown>;

function formatAction(value: unknown): string {
  return ACTION_LABEL[String(value)] ?? String(value ?? '-');
}

export default function BizAuditLogs() {
  const canRead = useBizPermission('operation.user.manage');
  const [users, setUsers] = useState<LogRow[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [username, setUsername] = useState<string>();
  const [actionType, setActionType] = useState<string>();
  const [targetType, setTargetType] = useState<string>();
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs] | null>(null);

  const loadUsers = useCallback(async () => {
    const data = await bizAdminListUsers();
    setUsers((data.items ?? []).filter((item) => String(item.roleCode) !== 'super_admin'));
  }, []);

  const loadLogs = useCallback(async (nextPage: number, nextPageSize: number) => {
    setLoading(true);
    try {
      const data = await bizOperationLogs({
        page: nextPage,
        pageSize: nextPageSize,
        ...(username ? { operatorUserId: username } : {}),
        ...(actionType ? { actionType } : {}),
        ...(targetType ? { targetType } : {}),
        ...(dateRange?.[0] ? { dateFrom: dateRange[0].startOf('day').toISOString() } : {}),
        ...(dateRange?.[1] ? { dateTo: dateRange[1].endOf('day').toISOString() } : {}),
      });
      setLogs(data.items ?? []);
      setTotal(Number(data.total ?? 0));
      setPage(Number(data.page ?? nextPage));
      setPageSize(Number(data.pageSize ?? nextPageSize));
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { message?: string } } }).response?.data?.message;
      message.error(detail ?? '日志加载失败');
    } finally {
      setLoading(false);
    }
  }, [actionType, dateRange, targetType, username]);

  useEffect(() => {
    if (canRead === true) {
      void loadUsers();
      void loadLogs(1, pageSize);
    }
  }, [canRead, loadUsers]);

  const accountSummary = useMemo(() => {
    const map = new Map<string, { key: string; username: string; name: string; roleCode: string; cityName: string; count: number; latest: string }>();
    for (const row of logs) {
      const key = String(row.operatorUserId ?? '');
      const current = map.get(key) ?? {
        key,
        username: String(row.username ?? '-'),
        name: String(row.operatorName ?? '-'),
        roleCode: String(row.roleCode ?? ''),
        cityName: String(row.cityName ?? '-'),
        count: 0,
        latest: String(row.createdAt ?? ''),
      };
      current.count += 1;
      if (String(row.createdAt ?? '') > current.latest) current.latest = String(row.createdAt ?? '');
      map.set(key, current);
    }
    return Array.from(map.values());
  }, [logs]);

  if (canRead === null) return null;
  if (!canRead) return <Card>当前账号无日志查看权限</Card>;

  return (
    <div className="v3-content">
      <div className="v3-page-head">
        <div className="v3-page-titles">
          <Title level={4} style={{ margin: 0 }}>审计日志</Title>
          <Text type="secondary">按账号查看登录与业务操作记录，super 账号不展示。</Text>
        </div>
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={() => void loadLogs(1, pageSize)}>刷新</Button>
        </Space>
      </div>
      <Card style={{ marginBottom: 12 }}>
        <Space wrap>
          <Select
            allowClear
            placeholder="操作账号"
            style={{ width: 190 }}
            options={users.map((item) => ({ value: String(item.id), label: `${String(item.username)} · ${String(item.name ?? '')}` }))}
            onChange={(value) => { setUsername(value); setPage(1); }}
          />
          <Select
            allowClear
            placeholder="动作类型"
            style={{ width: 170 }}
            options={[
              { value: 'auth.login.success', label: '登录成功' },
              { value: 'auth.login.failed', label: '登录失败' },
              { value: 'contract.create', label: '新增合同' },
              { value: 'contract.update', label: '修改合同' },
              { value: 'order_batch.delete_failed', label: '删除订单批次' },
              { value: 'cost.create', label: '新增成本' },
              { value: 'cost.update', label: '修改成本' },
            ]}
            onChange={(value) => { setActionType(value); setPage(1); }}
          />
          <Select
            allowClear
            placeholder="对象类型"
            style={{ width: 150 }}
            options={[
              { value: 'user', label: '账号' },
              { value: 'contract', label: '合同' },
              { value: 'order_batch', label: '订单批次' },
              { value: 'order_row', label: '订单行' },
              { value: 'cost_entry', label: '成本' },
            ]}
            onChange={(value) => { setTargetType(value); setPage(1); }}
          />
          <DatePicker.RangePicker
            value={dateRange}
            onChange={(value) => { setDateRange(value as [Dayjs, Dayjs] | null); setPage(1); }}
            allowClear
          />
          <Button type="primary" onClick={() => void loadLogs(1, pageSize)}>查询</Button>
        </Space>
      </Card>
      <Card title={`账号概览（当前页 ${accountSummary.length} 个账号）`} style={{ marginBottom: 12 }}>
        <Table
          size="small"
          rowKey="key"
          pagination={false}
          dataSource={accountSummary}
          columns={[
            { title: '账号', dataIndex: 'username' },
            { title: '姓名', dataIndex: 'name' },
            { title: '角色', dataIndex: 'roleCode', render: (value: string) => <Tag color="blue">{ROLE_LABEL[value] ?? value}</Tag> },
            { title: '地市', dataIndex: 'cityName' },
            { title: '本页记录数', dataIndex: 'count' },
            { title: '最近记录', dataIndex: 'latest' },
          ]}
        />
      </Card>
      <Card title="登录与操作明细">
        <Table
          size="small"
          rowKey={(row) => String(row.id)}
          loading={loading}
          dataSource={logs}
          scroll={{ x: 'max-content' }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            pageSizeOptions: [10, 20, 50, 100],
            onChange: (nextPage, nextPageSize) => { void loadLogs(nextPage, nextPageSize); },
          }}
          columns={[
            { title: '时间', dataIndex: 'createdAt', width: 180 },
            { title: '账号', dataIndex: 'username', width: 150 },
            { title: '姓名', dataIndex: 'operatorName', width: 120 },
            { title: '角色', dataIndex: 'roleCode', render: (value: string) => ROLE_LABEL[value] ?? value },
            { title: '地市', dataIndex: 'cityName' },
            { title: '动作', dataIndex: 'actionType', render: formatAction },
            { title: '对象', dataIndex: 'targetType' },
            { title: '操作对象', dataIndex: 'targetDisplay', width: 260, render: (value: string) => <Text ellipsis={{ tooltip: value }}>{value}</Text> },
            { title: '原始对象 ID', dataIndex: 'targetId', width: 190, render: (value: string) => <Input size="small" readOnly value={value} style={{ width: 180 }} /> },
            { title: '结果', dataIndex: 'resultStatus', render: (value: string) => <Tag color={value === 'success' ? 'green' : 'red'}>{value === 'success' ? '成功' : value === 'failed' ? '失败' : value === 'rejected' ? '已拒绝' : value}</Tag> },
          ]}
        />
      </Card>
    </div>
  );
}
