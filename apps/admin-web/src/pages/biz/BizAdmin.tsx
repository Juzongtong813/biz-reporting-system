import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, Drawer, Form, Input, Modal, Select, Space, Table, Tag, Typography, message } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import {
  bizAdminCreateUser, bizAdminListUsers, bizAdminSetUserStatus, bizAdminResetPassword,
  bizAdminGetUserPermissions, bizAdminRoles, bizAdminProvinces, bizAdminCities,
} from '@/api/biz.api';

const { Title, Text } = Typography;

const ROLE_LABEL: Record<string, string> = {
  super_admin: '超级管理员', admin: '省级运营管理员', contract_manager: '合同管理员', city_user: '地市用户',
};

/** 账号与权限管理（新基线，仅 super_admin） */
export default function BizAdmin() {
  const [users, setUsers] = useState<Array<Record<string, unknown>>>([]);
  const [roles, setRoles] = useState<Array<{ code: string; name: string }>>([]);
  const [provinces, setProvinces] = useState<Array<{ id: string; name: string }>>([]);
  const [cities, setCities] = useState<Array<{ id: string; name: string; provinceId: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [permOpen, setPermOpen] = useState(false);
  const [permDetail, setPermDetail] = useState<{ roleCode: string; base: string[]; effective: string[] } | null>(null);
  const [form] = Form.useForm();
  const [createRole, setCreateRole] = useState<string>('admin');

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
    Modal.confirm({
      title: '重置密码',
      content: '重置后旧会话将立即失效，新密码默认 6 位以上，请输入：',
      okText: '确认重置',
      onOk: () => new Promise<void>((resolve, reject) => {
        // 简单实现：固定提示走抽屉式输入过于繁琐，此处用 window.prompt 简化
        const pwd = window.prompt('请输入新密码（至少 6 位）');
        if (!pwd || pwd.length < 6) { message.warning('密码最低 6 位'); reject(); return; }
        bizAdminResetPassword(id, pwd).then(() => { message.success('已重置'); void load(); resolve(); }).catch((e) => { message.error('重置失败'); reject(e); });
      }),
    });
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
        <Space>
          <Button size="small" onClick={() => onViewPerm(String(row.id))}>权限</Button>
          <Button size="small" danger={row.status === 'enabled'} onClick={() => onToggle(String(row.id), String(row.status))}>
            {row.status === 'enabled' ? '停用' : '启用'}
          </Button>
          <Button size="small" onClick={() => onResetPassword(String(row.id))}>重置密码</Button>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24, background: '#F5F7F8', minHeight: '100vh' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>账号与权限管理</Title>
          <Text type="secondary">新基线（biz_）· 仅 super_admin 可操作</Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>新建账号</Button>
      </div>
      <Card>
        <Table rowKey={(r) => String(r.id)} loading={loading} columns={columns} dataSource={users} pagination={{ pageSize: 10 }} />
      </Card>

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
