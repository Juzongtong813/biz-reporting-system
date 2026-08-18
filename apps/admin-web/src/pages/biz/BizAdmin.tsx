import { useCallback, useEffect, useState } from 'react';
import { Spin } from 'antd';
import { useBizPermission } from '@/utils/biz-permission';
import { Badge, Button, Card, Drawer, Form, Input, Modal, Select, Space, Table, Tabs, Tag, Typography, message } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { Result } from 'antd';
import {
  bizAdminCreateUser, bizAdminListUsers, bizAdminSetUserStatus, bizAdminResetPassword,
  bizAdminGetUserPermissions, bizAdminRoles, bizAdminModules, bizAdminPermissions, bizAdminProvinces, bizAdminCities,
  bizOperationLogs,
} from '@/api/biz.api';

const { Title, Text } = Typography;

const ROLE_LABEL: Record<string, string> = {
  super_admin: '超级管理员', admin: '省级运营管理员', contract_manager: '合同管理员', city_user: '地市用户',
};

/** 账号与权限管理（新基线，仅 super_admin） */
function OperationLogsPanel() {
  const [logs, setLogs] = useState<Array<Record<string, unknown>>>([]);
  const loadLogs = useCallback(async () => {
    try {
      const data = await bizOperationLogs({ limit: 100 });
      setLogs(data.items);
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { message?: string } } }).response?.data?.message;
      message.error(detail ?? '审计日志加载失败');
    }
  }, []);
  useEffect(() => { void loadLogs(); }, [loadLogs]);
  return (
    <Card>
      <Table
        size="small" rowKey="id" dataSource={logs} pagination={{ pageSize: 10 }}
        scroll={{ x: 'max-content' }}
        columns={[
          { title: '时间', dataIndex: 'createdAt', key: 'createdAt', width: 170 },
          { title: '操作人', dataIndex: 'operatorUserId', key: 'op', render: (v: string) => v?.slice(0, 8) ?? '-' },
          { title: '动作', dataIndex: 'actionType', key: 'action', width: 180 },
          { title: '对象', dataIndex: 'targetType', key: 'tt', width: 110 },
          { title: '对象 ID', dataIndex: 'targetId', key: 'tid', render: (v: string) => v?.slice(0, 12) ?? '-' },
          { title: '结果', dataIndex: 'resultStatus', key: 'result' },
        ]}
      />
    </Card>
  );
}

export default function BizAdmin() {
  const canManage = useBizPermission('operation.user.manage');
  const [users, setUsers] = useState<Array<Record<string, unknown>>>([]);
  const [roles, setRoles] = useState<Array<{ code: string; name: string }>>([]);
  const [provinces, setProvinces] = useState<Array<{ id: string; name: string }>>([]);
  const [cities, setCities] = useState<Array<{ id: string; name: string; provinceId: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetUserId, setResetUserId] = useState<string | null>(null);
  const [resetLoading, setResetLoading] = useState(false);
  const [permOpen, setPermOpen] = useState(false);
  const [permDetail, setPermDetail] = useState<{ roleCode: string; base: string[]; effective: string[] } | null>(null);
  const [form] = Form.useForm();
  const [resetForm] = Form.useForm<{ password: string }>();
  const [createRole, setCreateRole] = useState<string>('admin');
  const [roleRows, setRoleRows] = useState<Array<Record<string, unknown>>>([]);
  const [moduleRows, setModuleRows] = useState<Array<Record<string, unknown>>>([]);
  const [permissionRows, setPermissionRows] = useState<Array<Record<string, unknown>>>([]);
  const [dictLoading, setDictLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [u, r, p, c] = await Promise.all([bizAdminListUsers(), bizAdminRoles(), bizAdminProvinces(), bizAdminCities()]);
      setUsers(u.items);
      setRoles(r.items.map((x) => ({ code: String(x.code), name: String(x.name) })));
      setProvinces(p.items.map((x) => ({ id: String(x.id), name: String(x.name) })));
      setCities(c.items.map((x) => ({ id: String(x.id), name: String(x.name), provinceId: String(x.provinceId) })));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDict = useCallback(async () => {
    setDictLoading(true);
    try {
      const [roles, mods, perms] = await Promise.all([bizAdminRoles(), bizAdminModules(), bizAdminPermissions()]);
      setRoleRows(roles.items as Array<Record<string, unknown>>);
      setModuleRows(mods.items as Array<Record<string, unknown>>);
      setPermissionRows(perms.items as Array<Record<string, unknown>>);
    } finally {
      setDictLoading(false);
    }
  }, []);

  useEffect(() => { void loadDict(); }, [loadDict]);

  useEffect(() => { void load(); }, [load]);

  const onCreate = async (values: Record<string, unknown>) => {
    try {
      await bizAdminCreateUser(values as { username: string; password: string; name: string; roleCode: string; cityId?: string | null });
      message.success('账号已创建');
      setCreateOpen(false);
      form.resetFields();
      void load();
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { message?: string | string[] } } }).response?.data?.message;
      message.error(Array.isArray(detail) ? detail.join('；') : (detail ?? '创建失败'));
    }
  };

  const onToggle = async (id: string, status: string) => {
    try {
      await bizAdminSetUserStatus(id, status === 'enabled' ? 'disabled' : 'enabled');
      message.success('已更新');
      void load();
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { message?: string } } }).response?.data?.message;
      message.error(detail ?? '操作失败');
    }
  };

  const onResetPassword = async (id: string) => {
    resetForm.resetFields();
    setResetUserId(id);
    setResetOpen(true);
  };

  const onSubmitResetPassword = async ({ password }: { password: string }) => {
    if (!resetUserId) return;
    setResetLoading(true);
    try {
      await bizAdminResetPassword(resetUserId, password);
      message.success('密码已重置，请使用新密码重新登录');
      setResetOpen(false);
      setResetUserId(null);
      void load();
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { message?: string } } }).response?.data?.message;
      message.error(detail ?? '重置密码失败，请稍后重试');
    } finally {
      setResetLoading(false);
    }
  };

  const onViewPerm = async (id: string) => {
    const detail = await bizAdminGetUserPermissions(id);
    setPermDetail(detail);
    setPermOpen(true);
  };

  const columns = [
    { title: '账号', dataIndex: 'username', key: 'username' },
    { title: '姓名', dataIndex: 'name', key: 'name' },
    { title: '角色', dataIndex: 'roleCode', key: 'roleCode', render: (v: string) => <Tag color="blue">{ROLE_LABEL[v] ?? v}</Tag> },
    { title: '状态', dataIndex: 'status', key: 'status', render: (v: string) => <Badge status={v === 'enabled' ? 'success' : 'error'} text={v === 'enabled' ? '启用' : '停用'} /> },
    {
      title: '操作', key: 'action', width: 260,
      render: (_: unknown, row: Record<string, unknown>) => (
        <Space wrap>
          <Button size="small" onClick={() => onViewPerm(String(row.id))}>权限</Button>
          <Button size="small" danger={row.status === 'enabled'} onClick={() => onToggle(String(row.id), String(row.status))}>
            {row.status === 'enabled' ? '停用' : '启用'}
          </Button>
          <Button size="small" onClick={() => onResetPassword(String(row.id))}>重置密码</Button>
        </Space>
      ),
    },
  ];

  if (canManage === null) return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}><Spin /></div>;
  if (!canManage) return <Result status="403" title="无权限访问" subTitle="账号与权限管理仅 super_admin 可操作。" />;

  return (
    <div className="v3-content">
      <div className="v3-page-head">
        <div className="v3-page-titles">
          <Title level={4} style={{ margin: 0 }}>账号与权限管理</Title>
        </div>
        <div className="v3-page-head-actions">
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>新建账号</Button>
        </div>
      </div>
      <Tabs
        defaultActiveKey="users"
        items={[
          {
            key: 'users', label: '用户管理',
            children: (
              <Card>
                <Table scroll={{ x: "max-content" }}  rowKey={(r) => String(r.id)} loading={loading} columns={columns} dataSource={users} pagination={{ pageSize: 10 }} />
              </Card>
            ),
          },
          {
            key: 'roles', label: '角色字典',
            children: (
              <Card>
                <Table scroll={{ x: "max-content" }}  rowKey="id" size="small" loading={dictLoading} dataSource={roleRows} pagination={false}
                  columns={[
                    { title: '角色编码', dataIndex: 'code', key: 'code' },
                    { title: '角色名称', dataIndex: 'name', key: 'name' },
                    { title: '说明', dataIndex: 'description', key: 'description', render: (v: unknown) => String(v ?? '-') },
                  ]}
                />
              </Card>
            ),
          },
          {
            key: 'modules', label: '模块字典',
            children: (
              <Card>
                <Table scroll={{ x: "max-content" }}  rowKey="id" size="small" loading={dictLoading} dataSource={moduleRows} pagination={{ pageSize: 10 }}
                  columns={[
                    { title: '模块编码', dataIndex: 'code', key: 'code' },
                    { title: '名称', dataIndex: 'name', key: 'name' },
                    { title: '层级', dataIndex: 'level', key: 'level' },
                    { title: '排序', dataIndex: 'sortOrder', key: 'sortOrder' },
                  ]}
                />
              </Card>
            ),
          },
          {
            key: 'audit', label: '操作审计',
            children: <OperationLogsPanel />,
          },
          {
            key: 'permissions', label: '权限点',
            children: (
              <Card>
                <Table scroll={{ x: "max-content" }}  rowKey="code" size="small" loading={dictLoading} dataSource={permissionRows} pagination={{ pageSize: 20 }}
                  columns={[
                    { title: '权限编码', dataIndex: 'code', key: 'code' },
                    { title: '名称', dataIndex: 'name', key: 'name' },
                    { title: '操作', dataIndex: 'action', key: 'action' },
                  ]}
                />
              </Card>
            ),
          },
        ]}
      />

      <Drawer title="新建账号" open={createOpen} onClose={() => setCreateOpen(false)} width={420}>
        <Form form={form} layout="vertical" onFinish={onCreate} initialValues={{ roleCode: 'admin' }}>
          <Form.Item name="username" label="账号" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="password" label="初始密码" rules={[{ required: true, min: 6, message: '密码最低 6 位' }]}><Input.Password /></Form.Item>
          <Form.Item name="name" label="姓名" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="roleCode" label="角色" rules={[{ required: true }]}>
            <Select onChange={(v) => setCreateRole(String(v))} options={roles.filter((r) => r.code !== 'super_admin').map((r) => ({ value: r.code, label: r.name }))} />
          </Form.Item>
          <Form.Item name="cityId" label="绑定地市" extra={createRole === 'city_user' ? '地市用户必选' : '仅地市用户需要'}>
            <Select allowClear placeholder="选择地市" options={cities.map((c) => ({ value: c.id, label: c.name }))} />
          </Form.Item>
          <Button type="primary" htmlType="submit" block>创建</Button>
        </Form>
      </Drawer>

      <Modal
        title="重置密码"
        open={resetOpen}
        confirmLoading={resetLoading}
        okText="确认重置"
        cancelText="取消"
        onCancel={() => { setResetOpen(false); setResetUserId(null); }}
        onOk={() => { void resetForm.validateFields().then(onSubmitResetPassword).catch(() => undefined); }}
        destroyOnClose
      >
        <p>重置后旧会话将立即失效。新密码至少 6 位，请在下方输入。</p>
        <Form form={resetForm} layout="vertical" onFinish={onSubmitResetPassword}>
          <Form.Item name="password" label="新密码" rules={[{ required: true, min: 6, message: '密码至少 6 位' }]}>
            <Input.Password autoComplete="new-password" placeholder="请输入新密码" />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer title="用户最终权限" open={permOpen} onClose={() => setPermOpen(false)} width={480}>
        {permDetail && (
          <div>
            <p><b>角色：</b>{ROLE_LABEL[permDetail.roleCode] ?? permDetail.roleCode}</p>
            <p><b>基础权限（角色默认）：</b></p>
            <div style={{ maxHeight: 200, overflow: 'auto', marginBottom: 16 }}>
              {permDetail.base.map((code) => <Tag key={code} style={{ marginBottom: 4 }}>{code}</Tag>)}
            </div>
            <p><b>最终权限（含账号例外）：</b></p>
            <div style={{ maxHeight: 300, overflow: 'auto' }}>
              {permDetail.effective.map((code) => <Tag key={code} color="green" style={{ marginBottom: 4 }}>{code}</Tag>)}
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
