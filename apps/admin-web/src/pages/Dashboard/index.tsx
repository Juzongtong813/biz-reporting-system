/**
 * 仪表盘页面
 *
 * 展示 4 个统计卡片：地市总数、合同总数、本月已提交、逾期未提交
 * 数据来自 GET /api/admin/dashboard（⚠️ 后端未实现，当前仅 Mock 可用）
 */
import { Card, Col, Row, Statistic, Spin } from 'antd';
import {
  HomeOutlined,
  FileTextOutlined,
  CheckCircleOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import * as dashboardApi from '@/api/dashboard.api';

export default function Dashboard() {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: dashboardApi.getDashboard,
  });

  if (isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <Spin size="large" />
      </div>
    );
  }

  const stats = [
    {
      title: '地市总数',
      value: data?.totalCities ?? '-',
      icon: <HomeOutlined style={{ fontSize: 36, color: '#1890ff' }} />,
      color: '#e6f7ff',
    },
    {
      title: '合同总数',
      value: data?.totalContracts ?? '-',
      icon: <FileTextOutlined style={{ fontSize: 36, color: '#52c41a' }} />,
      color: '#f6ffed',
    },
    {
      title: '本月已填报',
      value: data?.reportedThisMonth ?? '-',
      icon: <CheckCircleOutlined style={{ fontSize: 36, color: '#722ed1' }} />,
      color: '#f9f0ff',
    },
    {
      title: '逾期未提交',
      value: data?.overdueNotSubmitted ?? '-',
      icon: <WarningOutlined style={{ fontSize: 36, color: '#faad14' }} />,
      color: '#fffbe6',
    },
  ];

  return (
    <Row gutter={[16, 16]}>
      {stats.map((item) => (
        <Col xs={24} sm={12} lg={6} key={item.title}>
          <Card>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: 12,
                  background: item.color,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {item.icon}
              </div>
              <Statistic title={item.title} value={item.value} />
            </div>
          </Card>
        </Col>
      ))}
    </Row>
  );
}
