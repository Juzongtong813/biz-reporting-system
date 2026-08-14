import { useState } from 'react';
import { Alert, Button, Card, Form, Input, Typography } from 'antd';
import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { bizLogin } from '@/api/biz.api';
import { setBizToken } from '@/utils/biz-auth';

const { Title, Text } = Typography;

/** biz 登录页（新基线）：用户名+密码；5 次失败锁定 15 分钟由后端控制 */
export default function BizLogin() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFinish = async (values: { username: string; password: string }) => {
    setLoading(true);
    setError(null);
    try {
      const result = await bizLogin(values.username, values.password);
      setBizToken(result.accessToken);
      navigate('/biz/portal', { replace: true });
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { message?: string | string[] } } }).response?.data?.message;
      setError(Array.isArray(detail) ? detail.join('；') : (detail ?? '登录失败'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#F5F7F8' }}>
      <Card style={{ width: 380, boxShadow: '0 2px 12px rgba(23,58,83,.08)' }}>
        <div style={{ marginBottom: 16 }}>
          <Title level={4} style={{ margin: 0 }}>维护管理经营数据中台</Title>
          <Text type="secondary">两级模块门户 · 经营管理</Text>
        </div>
        {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
        <Form onFinish={onFinish} size="large" disabled={loading}>
          <Form.Item name="username" rules={[{ required: true, message: '请输入账号' }]}>
            <Input prefix={<UserOutlined />} placeholder="账号" autoComplete="username" />
          </Form.Item>
          <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="密码" autoComplete="current-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={loading}>登 录</Button>
        </Form>
      </Card>
    </div>
  );
}
