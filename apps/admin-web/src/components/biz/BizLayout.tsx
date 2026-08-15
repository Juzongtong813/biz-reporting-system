import { useCallback, useEffect, useState } from 'react';
import { Avatar, Button, Drawer, Dropdown, Layout, Menu, Space, Typography } from 'antd';
import {
  ApartmentOutlined, BarChartOutlined, FileTextOutlined, InboxOutlined, SettingOutlined,
  TeamOutlined, UserOutlined, WalletOutlined, MenuOutlined,
} from '@ant-design/icons';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { bizMe } from '@/api/biz.api';
import { clearBizToken } from '@/utils/biz-auth';

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

const ROLE_LABEL: Record<string, string> = {
  super_admin: '超级管理员', admin: '省级运营管理员', contract_manager: '合同管理员', city_user: '地市用户',
};

/** 按权限码过滤菜单（super_admin 通配） */
function filterByPermission(items: Array<{ key: string; label: string; icon?: React.ReactNode; permission?: string }>, permissions: Set<string>, isSuper: boolean) {
  return items.filter((i) => !i.permission || isSuper || permissions.has(i.permission));
}

/** 新基线统一布局：顶部用户 + 侧边菜单（经营管理六入口 + 系统管理） */
export default function BizLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [me, setMe] = useState<{ username: string; roleCode: string; permissions: string[] } | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

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

  const menuItems = [
    { key: 'group-ops', type: 'group' as const, label: '经营管理' },
    ...filterByPermission([
      { key: '/biz/operation', label: '合同管理', icon: <FileTextOutlined />, permission: 'operation.contract.read' },
      { key: '/biz/orders', label: '订单管理', icon: <InboxOutlined />, permission: 'operation.order.read' },
      { key: '/biz/offline-completions', label: '线下完工', icon: <TeamOutlined />, permission: 'operation.completion.read' },
      { key: '/biz/costs', label: '地市成本', icon: <WalletOutlined />, permission: 'operation.cost.read' },
      { key: '/biz/analysis', label: '经营分析', icon: <BarChartOutlined />, permission: 'operation.analysis.read' },
    ], permSet, isSuper),
    { key: 'group-sys', type: 'group' as const, label: '系统管理' },
    ...filterByPermission([
      { key: '/biz/settings', label: '系统设置', icon: <SettingOutlined />, permission: 'operation.settings.read' },
      { key: '/biz/admin', label: '权限管理', icon: <ApartmentOutlined />, permission: 'operation.user.manage' },
    ], permSet, isSuper),
  ];

  const selectedKey = menuItems.find((i) => i.key && location.pathname.startsWith(String(i.key)))?.key ?? '/biz/operation';

  const menu = (
    <Menu
      mode="inline"
      theme="dark"
      style={{ borderInlineEnd: 'none' }}
      selectedKeys={selectedKey ? [String(selectedKey)] : []}
      items={menuItems}
      onClick={({ key }) => { navigate(String(key)); if (isMobile) setMobileOpen(false); }}
    />
  );

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {!isMobile && (
        <Sider collapsible collapsed={collapsed} onCollapse={setCollapsed} width={208} style={{ position: 'sticky', top: 0, height: '100vh' }}>
          <div style={{ height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 600, fontSize: 14 }}>
            {collapsed ? '中台' : '维护管理经营数据中台'}
          </div>
          {menu}
        </Sider>
      )}
      <Layout>
        <Header style={{ background: '#fff', padding: '0 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e8edf0', height: 48, lineHeight: '48px' }}>
          <Space>
            {isMobile && <Button type="text" icon={<MenuOutlined />} onClick={() => setMobileOpen(true)} />}
            {isMobile && <Text strong>经营数据中台</Text>}
          </Space>
          <Dropdown
            menu={{ items: [{ key: 'logout', label: '退出登录', onClick: () => { clearBizToken(); navigate('/biz/login'); } }] }}
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
      <Drawer placement="left" open={isMobile && mobileOpen} onClose={() => setMobileOpen(false)} width={240} styles={{ body: { padding: 0 } }}>
        <div style={{ padding: 16, fontWeight: 600 }}>维护管理经营数据中台</div>
        {menu}
      </Drawer>
    </Layout>
  );
}
