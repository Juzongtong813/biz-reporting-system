import { useEffect, useState } from 'react';
import { Button, Card, Empty, Result, Spin, Typography } from 'antd';
import { ApartmentOutlined, BarChartOutlined, TeamOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { bizMe, bizPortalModules, type BizModuleItem } from '@/api/biz.api';
import { clearBizToken } from '@/utils/biz-auth';

const { Title, Text } = Typography;

const MODULE_ICON: Record<string, React.ReactNode> = {
  operation: <BarChartOutlined style={{ fontSize: 28 }} />,
  asset: <ApartmentOutlined style={{ fontSize: 28 }} />,
  personnel: <TeamOutlined style={{ fontSize: 28 }} />,
};

/** 维护管理二级门户（新基线）：只展示有权二级模块；经营管理=实际业务，资产/人员=占位 */
export default function BizMaintenancePortal() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [modules, setModules] = useState<BizModuleItem[]>([]);
  const [userName, setUserName] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [me, data] = await Promise.all([bizMe(), bizPortalModules()]);
        setUserName(me.username);
        setModules(data.level2.filter((m) => m.parentId !== undefined || true));
        setLoading(false);
      } catch {
        setError('登录已失效，请重新登录');
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}><Spin tip="加载中" /></div>;
  if (error) return (
    <Result status="403" title={error} extra={<Button type="primary" onClick={() => { clearBizToken(); navigate('/biz/login'); }}>返回登录</Button>} />
  );

  return (
    <div style={{ minHeight: '100vh', background: '#F5F7F8', padding: 48 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <Title level={3} style={{ margin: 0 }}>维护管理</Title>
          <Text type="secondary">二级模块门户 · 当前账号：{userName}</Text>
        </div>
        <Button onClick={() => navigate('/biz/portal')}>返回一级门户</Button>
      </div>
      {modules.length === 0 ? (
        <Empty description="当前账号无任何二级模块权限" />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16, maxWidth: 780 }}>
          {modules.map((m) => (
            <Card
              key={m.code}
              hoverable
              onClick={() => navigate(m.code === 'operation' ? '/biz/operation' : `/biz/placeholder/${m.code}`)}
              style={{ textAlign: 'center', padding: 16 }}
            >
              <div style={{ color: '#173A53', marginBottom: 8 }}>{MODULE_ICON[m.code] ?? null}</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: '#173A53' }}>{m.name}</div>
              {m.code === 'operation' && <div style={{ color: '#0F766E', fontSize: 12, marginTop: 4 }}>进入实际业务</div>}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
