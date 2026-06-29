/**
 * AdminLayout — 后台标准布局框架
 *
 * 左侧菜单 + 顶部面包屑&用户区 + 右侧内容区
 * 使用 Ant Design Layout 组件，手写轻量版（不引入 pro-components）。
 */
import { useState } from 'react';
import { Layout, Menu, Button, Breadcrumb, Dropdown, Space, Typography } from 'antd';
import {
  DashboardOutlined,
  FileTextOutlined,
  SnippetsOutlined,
  TeamOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  UserOutlined,
  LogoutOutlined,
  ExperimentOutlined,
} from '@ant-design/icons';
import { useNavigate, useLocation } from 'react-router-dom';
import { clearToken } from '@/utils/auth';
import type { MenuItem } from '@/types';

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

const menuItems: MenuItem[] = [
  { key: '/admin/dashboard', label: '仪表盘', icon: <DashboardOutlined />, path: '/admin/dashboard' },
  { key: '/admin/contracts', label: '合同管理', icon: <FileTextOutlined />, path: '/admin/contracts' },
  { key: '/admin/packages', label: '报表包管理', icon: <SnippetsOutlined />, path: '/admin/packages' },
  { key: '/admin/users', label: '用户管理', icon: <TeamOutlined />, path: '/admin/users' },
  { key: '/admin/ws6-tasks', label: '任务中心', icon: <ExperimentOutlined />, path: '/admin/ws6-tasks' },
];

interface AdminLayoutProps {
  children: React.ReactNode;
}

export default function AdminLayout({ children }: AdminLayoutProps) {
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  // 根据当前路径高亮菜单
  const selectedKey = menuItems.find((item) =>
    location.pathname.startsWith(item.key),
  )?.key;

  // 面包屑：从路径中解析
  const pathParts = location.pathname.split('/').filter(Boolean);
  const breadcrumbItems = [
    { title: '首页' },
    ...pathParts.slice(1).map((part) => ({
      title: menuItems.find((m) => m.key.includes(part))?.label || part,
    })),
  ];

  function handleMenuClick({ key }: { key: string }) {
    navigate(key);
  }

  function handleLogout() {
    clearToken();
    navigate('/login', { replace: true });
  }

  const userMenuItems = [
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: '退出登录',
      onClick: handleLogout,
    },
  ];

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {/* 左侧边栏 */}
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        theme="dark"
        width={220}
      >
        <div
          style={{
            height: 48,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '8px 0',
          }}
        >
          <Text
            strong
            style={{
              color: '#fff',
              fontSize: collapsed ? 14 : 16,
              whiteSpace: 'nowrap',
            }}
          >
            {collapsed ? '经营' : '经营单元上报系统'}
          </Text>
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={selectedKey ? [selectedKey] : []}
          items={menuItems.map((item) => ({
            key: item.key,
            icon: item.icon,
            label: item.label,
          }))}
          onClick={handleMenuClick}
        />
      </Sider>

      <Layout>
        {/* 顶部栏 */}
        <Header
          style={{
            background: '#fff',
            padding: '0 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid #f0f0f0',
          }}
        >
          <Space>
            <Button
              type="text"
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setCollapsed(!collapsed)}
            />
            <Breadcrumb items={breadcrumbItems} />
          </Space>

          <Dropdown menu={{ items: userMenuItems }} trigger={['click']}>
            <Space style={{ cursor: 'pointer' }}>
              <UserOutlined />
              <Text>管理员</Text>
            </Space>
          </Dropdown>
        </Header>

        {/* 内容区 */}
        <Content style={{ margin: 16, minHeight: 280 }}>{children}</Content>
      </Layout>
    </Layout>
  );
}
