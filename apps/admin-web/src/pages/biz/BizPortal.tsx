import { useEffect, useState } from 'react';
import { Button, Card, Empty, Result, Space, Spin, Typography } from 'antd';
import { ApartmentOutlined, ToolOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { bizMe, bizPortalModules, bizAnalysisOverview, type BizModuleItem } from '@/api/biz.api';
import { clearBizToken } from '@/utils/biz-auth';

const { Title, Text } = Typography;

const MODULE_ICON: Record<string, React.ReactNode> = {
  engineering: <ToolOutlined style={{ fontSize: 28 }} />,
  maintenance: <ApartmentOutlined style={{ fontSize: 28 }} />,
};

/** 一级模块门户（新基线）：登录后始终进入；只展示有权模块 */
export default function BizPortal() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [modules, setModules] = useState<BizModuleItem[]>([]);
  const [userName, setUserName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [overview, setOverview] = useState<{ contractCount: number; totalContractAmountFen: number; totalCompletionFen: number; netProfitFen: number } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [me, data] = await Promise.all([bizMe(), bizPortalModules()]);
        setUserName(me.username);
        setModules(data.level1);
        void bizAnalysisOverview().then(setOverview).catch(() => {});
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
    <div style={{ minHeight: '100vh', background: '#F5F7F8', padding: 48 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <Title level={3} style={{ margin: 0 }}>一级模块门户</Title>
          <Text type="secondary">当前账号：{userName}</Text>
        </div>
        <Button onClick={() => { clearBizToken(); navigate('/biz/login'); }}>退出登录</Button>
      </div>
      {overview && (
        <Card size="small" style={{ marginBottom: 16, maxWidth: 760 }}>
          <Space wrap style={{ width: '100%', justifyContent: 'space-between' }}>
            <Text strong>经营概览</Text>
            <Text>合同 {overview.contractCount} 个 · 合同额 {(overview.totalContractAmountFen / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2 })} 元 · 总完工 {(overview.totalCompletionFen / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2 })} 元 · 净利 {(overview.netProfitFen / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2 })} 元</Text>
            <Button size="small" type="link" onClick={() => navigate('/biz/analysis')}>进入经营分析 →</Button>
          </Space>
        </Card>
      )}
      {modules.length === 0 ? (
        <Empty description="当前账号无任何一级模块权限" />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16, maxWidth: 760 }}>
          {modules.map((m) => (
            <Card
              key={m.code}
              hoverable
              onClick={() => navigate(m.code === 'maintenance' ? '/biz/maintenance' : `/biz/placeholder/${m.code}`)}
              style={{ textAlign: 'center', padding: 16 }}
            >
              <div style={{ color: '#173A53', marginBottom: 8 }}>{MODULE_ICON[m.code] ?? null}</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: '#173A53' }}>{m.name}</div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
