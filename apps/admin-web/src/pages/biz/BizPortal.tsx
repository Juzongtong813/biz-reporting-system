import { useEffect, useState } from 'react';
import { Button, Card, Empty, Result, Spin, Typography } from 'antd';
import { ApartmentOutlined, BarChartOutlined, ToolOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { bizMe, bizPortalModules, type BizModuleItem } from '@/api/biz.api';
import { clearBizToken } from '@/utils/biz-auth';

const { Title, Text } = Typography;

const MODULE_ICON: Record<string, React.ReactNode> = {
  engineering: <ToolOutlined style={{ fontSize: 28 }} />,
  maintenance: <ApartmentOutlined style={{ fontSize: 28 }} />,
  operation: <BarChartOutlined style={{ fontSize: 28 }} />,
};

/** 一级模块门户（新基线）：登录后始终进入；只展示有权模块 */
export default function BizPortal() {
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
        const operation = data.level2.find((module) => module.code === 'operation');
        const level1 = operation && !data.level1.some((module) => module.code === operation.code)
          ? [...data.level1, { ...operation, level: 'level1', parentId: null }]
          : data.level1;
        setModules(level1);
        setLoading(false);
      } catch {
        setError('登录已失效，请重新登录');
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}><Spin /></div>;
  if (error) return (
    <Result status="403" title={error} extra={<Button type="primary" onClick={() => { clearBizToken(); navigate('/biz/login'); }}>返回登录</Button>} />
  );

  return (
    <div className="v3-portal">
      <div className="v3-page-head">
        <div className="v3-page-titles">
          <Title level={3} style={{ margin: 0 }}>一级模块门户</Title>
        </div>
        <div className="v3-page-head-actions">
          <Button onClick={() => { clearBizToken(); navigate('/biz/login'); }}>退出登录</Button>
        </div>
      </div>
      {modules.length === 0 ? (
        <Empty description="当前账号无任何一级模块权限" />
      ) : (
        <div className="v3-portal-grid">
          {modules.map((m) => (
            <Card
              key={m.code}
              hoverable
              onClick={() => navigate(m.code === 'maintenance' ? '/biz/maintenance' : m.code === 'operation' ? '/biz/operation' : `/biz/placeholder/${m.code}`)}
              style={{ textAlign: 'center', padding: 16 }}
            >
              <div className="biz-module-icon" style={{ marginBottom: 8 }}>{MODULE_ICON[m.code] ?? null}</div>
              <div className="biz-module-title">{m.name}</div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
