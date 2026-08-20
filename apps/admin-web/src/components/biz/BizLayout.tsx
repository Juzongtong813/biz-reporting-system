import { useCallback, useEffect, useState } from 'react';
import { Avatar, Button, Drawer, Dropdown, Form, Input, Layout, Menu, Modal, Space, Typography, message, type MenuProps } from 'antd';
import {
  ApartmentOutlined, BarChartOutlined, FileTextOutlined, InboxOutlined, SettingOutlined,
  KeyOutlined, TeamOutlined, UserOutlined, WalletOutlined, MenuOutlined,
} from '@ant-design/icons';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { bizChangeOwnPassword, bizMe } from '@/api/biz.api';
import { clearBizToken } from '@/utils/biz-auth';

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

const ROLE_LABEL: Record<string, string> = {
  super_admin: '超级管理员', admin: '省级运营管理员', contract_manager: '合同管理员', city_user: '地市用户',
};

/** 按权限码过滤菜单（super_admin 通配） */
type PermissionMenuItem = { key: string; label: string; icon?: React.ReactNode; permission?: string };

function filterByPermission(items: PermissionMenuItem[], permissions: Set<string>, isSuper: boolean): NonNullable<MenuProps['items']> {
  return items
    .filter((i) => !i.permission || isSuper || permissions.has(i.permission))
    .map(({ permission: _permission, ...item }) => item);
}

/** 新基线统一布局：顶部用户 + 侧边菜单（经营管理六入口 + 系统管理） */
export default function BizLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [me, setMe] = useState<{ username: string; roleCode: string; permissions: string[] } | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordForm] = Form.useForm<{ currentPassword: string; newPassword: string; confirmPassword: string }>();

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    bizMe().then(setMe).catch(() => { clearBizToken(); navigate('/biz/login'); });
  }, [navigate]);

  const permissions = useCallback(() => new Set(me?.permissions ?? []), [me]);
  const isSuper = me?.roleCode === 'super_admin';
  const permSet = permissions();

  const submitPasswordChange = async (values: { currentPassword: string; newPassword: string; confirmPassword: string }) => {
    setPasswordSaving(true);
    try {
      await bizChangeOwnPassword(values);
      message.success('密码修改成功，请重新登录');
      setPasswordOpen(false);
      passwordForm.resetFields();
      clearBizToken();
      navigate('/biz/login', { replace: true });
    } catch (error: unknown) {
      const responseMessage = (error as { response?: { data?: { message?: string | string[] } } }).response?.data?.message;
      message.error(Array.isArray(responseMessage) ? responseMessage.join('；') : (responseMessage ?? '密码修改失败'));
    } finally {
      setPasswordSaving(false);
    }
  };

  const systemItems = filterByPermission([
    { key: '/biz/settings', label: '系统设置', icon: <SettingOutlined />, permission: 'operation.settings.read' },
    { key: '/biz/admin', label: '权限管理', icon: <ApartmentOutlined />, permission: 'operation.user.manage' },
  ], permSet, isSuper);

  const analysisItems = filterByPermission([
    { key: '/biz/analysis', label: '经营分析', icon: <BarChartOutlined />, permission: 'operation.analysis.read' },
  ], permSet, isSuper);
  const contractItems = filterByPermission([
    { key: '/biz/operation', label: '合同详情', icon: <FileTextOutlined />, permission: 'operation.contract.read' },
  ], permSet, isSuper);
  const costItems = filterByPermission([
    { key: '/biz/costs', label: '地市成本', icon: <WalletOutlined />, permission: 'operation.cost.read' },
  ], permSet, isSuper);
  const completionItems = filterByPermission([
    { key: '/biz/orders', label: '订单管理', icon: <InboxOutlined />, permission: 'operation.order.upload' },
    { key: '/biz/offline-completions', label: '线下完工', icon: <TeamOutlined />, permission: 'operation.completion.read' },
  ], permSet, isSuper);

  const businessItems: NonNullable<MenuProps['items']> = [
    ...analysisItems,
    ...(contractItems.length > 0 ? [{ key: 'biz-contract', label: '合同管理', icon: <FileTextOutlined />, children: contractItems }] : []),
    ...(costItems.length > 0 ? [{ key: 'biz-cost', label: '成本管理', icon: <WalletOutlined />, children: costItems }] : []),
    ...(completionItems.length > 0 ? [{ key: 'biz-completion', label: '完工管理', icon: <TeamOutlined />, children: completionItems }] : []),
  ];
  const menuItems: MenuProps['items'] = [
    { key: 'group-ops', type: 'group', label: '经营管理' },
    ...businessItems,
    ...(systemItems.length > 0 ? [
      { key: 'group-sys', type: 'group' as const, label: '系统管理' },
      ...systemItems,
    ] : []),
  ];

  const selectedKey = ['/biz/analysis', '/biz/operation', '/biz/costs', '/biz/orders', '/biz/offline-completions']
    .find((key) => location.pathname.startsWith(key)) ?? '/biz/operation';
  const activeGroupKey = location.pathname.startsWith('/biz/operation')
    ? 'biz-contract'
    : location.pathname.startsWith('/biz/costs')
      ? 'biz-cost'
      : location.pathname.startsWith('/biz/orders') || location.pathname.startsWith('/biz/offline-completions')
        ? 'biz-completion'
        : undefined;
  const [openKeys, setOpenKeys] = useState<string[]>([]);
  const visibleOpenKeys = [...new Set([...openKeys, ...(activeGroupKey ? [activeGroupKey] : [])])];

  // 一级、二级门户独立呈现模块卡片，进入具体模块后才显示业务侧栏。
  const isModulePortal = location.pathname === '/biz/portal' || location.pathname === '/biz/maintenance';

  const menu = (
    <Menu
      className="biz-navigation"
      mode="inline"
      theme="dark"
      style={{ borderInlineEnd: 'none' }}
      selectedKeys={selectedKey ? [String(selectedKey)] : []}
      items={menuItems}
      openKeys={visibleOpenKeys}
      onOpenChange={(keys) => setOpenKeys(keys as string[])}
      onClick={({ key }) => { if (String(key).startsWith('/biz/')) navigate(String(key)); if (isMobile) setMobileOpen(false); }}
    />
  );

  if (isModulePortal) return <Outlet />;

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {!isMobile && (
        <Sider collapsible collapsed={collapsed} onCollapse={setCollapsed} width={200} style={{ position: 'sticky', top: 0, height: '100vh' }}>
          <div className="biz-sider-brand">
            <img className="biz-sider-logo" src={`${import.meta.env.BASE_URL}logo.jpg`} alt="中屹技术" />
            {!collapsed && <span className="biz-sider-name">经营管理</span>}
          </div>
          {menu}
        </Sider>
      )}
      <Layout>
        <Header className="biz-header" style={{ background: '#fff', padding: '0 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e8edf0', height: 48, lineHeight: '48px' }}>
          <Space>
            {isMobile && <Button type="text" icon={<MenuOutlined />} onClick={() => setMobileOpen(true)} />}
            {isMobile && <Text strong>经营数据中台</Text>}
          </Space>
          <Dropdown
            menu={{ items: [
              { key: 'password', icon: <KeyOutlined />, label: '修改密码', onClick: () => setPasswordOpen(true) },
              { type: 'divider' as const },
              { key: 'logout', label: '退出登录', onClick: () => { clearBizToken(); navigate('/biz/login'); } },
            ] }}
          >
            <Space style={{ cursor: 'pointer' }}>
              <Avatar size="small" icon={<UserOutlined />} style={{ background: '#2f9e62' }} />
              <Text>{me?.username ?? ''}</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>{me ? ROLE_LABEL[me.roleCode] ?? me.roleCode : ''}</Text>
            </Space>
          </Dropdown>
        </Header>
        <Content style={{ margin: 0, minHeight: 'calc(100vh - 48px)' }}>
          <Outlet />
        </Content>
      </Layout>
      <Drawer
        className="biz-mobile-drawer"
        placement="left"
        open={isMobile && mobileOpen}
        onClose={() => setMobileOpen(false)}
        width={240}
        styles={{ body: { padding: 0, background: '#001529' } }}
      >
        <div style={{ padding: 16, fontWeight: 600, color: '#fff' }}>经营管理</div>
        {menu}
      </Drawer>
      <Modal
        title="修改密码"
        open={passwordOpen}
        confirmLoading={passwordSaving}
        okText="确认修改"
        cancelText="取消"
        onCancel={() => { if (!passwordSaving) { setPasswordOpen(false); passwordForm.resetFields(); } }}
        onOk={() => { void passwordForm.submit(); }}
        destroyOnClose
      >
        <Form form={passwordForm} layout="vertical" onFinish={(values) => { void submitPasswordChange(values); }}>
          <Form.Item name="currentPassword" label="原密码" rules={[{ required: true, message: '请输入原密码' }]}>
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Form.Item name="newPassword" label="新密码" rules={[{ required: true, min: 8, max: 128, message: '新密码长度必须为 8-128 位' }]}>
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item name="confirmPassword" label="确认新密码" dependencies={['newPassword']} rules={[{ required: true, message: '请再次输入新密码' }, ({ getFieldValue }) => ({ validator(_, value) { return !value || getFieldValue('newPassword') === value ? Promise.resolve() : Promise.reject(new Error('两次输入的新密码不一致')); } })]}>
            <Input.Password autoComplete="new-password" />
          </Form.Item>
        </Form>
      </Modal>
    </Layout>
  );
}
