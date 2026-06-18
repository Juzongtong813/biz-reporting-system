/**
 * 登录页
 *
 * 功能：
 * - 用户名 + 密码表单
 * - 调用 POST /api/auth/admin/login
 * - 成功后保存 token → 跳转 /admin/dashboard
 */
import { useState } from 'react';
import { Form, Input, Button, Card, Typography, message, Space } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import * as authApi from '@/api/auth.api';
import { setToken } from '@/utils/auth';

const { Title, Text } = Typography;

interface LoginFormValues {
  username: string;
  password: string;
}

export default function Login() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  const loginMutation = useMutation({
    mutationFn: authApi.login,
    onSuccess: (data) => {
      setToken(data.token);
      message.success('登录成功');
      navigate('/admin/dashboard', { replace: true });
    },
    onError: () => {
      // 错误提示已在 request.ts 拦截器中处理
      setLoading(false);
    },
  });

  function handleFinish(values: LoginFormValues) {
    setLoading(true);
    loginMutation.mutate(values);
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      }}
    >
      <Card
        style={{ width: 400, boxShadow: '0 8px 24px rgba(0,0,0,0.15)' }}
        styles={{ body: { padding: 40 } }}
      >
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <div style={{ textAlign: 'center' }}>
            <Title level={3} style={{ marginBottom: 4 }}>
              经营单元上报系统
            </Title>
            <Text type="secondary">管理后台</Text>
          </div>

          <Form
            name="login"
            onFinish={handleFinish}
            size="large"
            autoComplete="off"
          >
            <Form.Item
              name="username"
              rules={[{ required: true, message: '请输入用户名' }]}
            >
              <Input
                prefix={<UserOutlined />}
                placeholder="用户名"
              />
            </Form.Item>

            <Form.Item
              name="password"
              rules={[{ required: true, message: '请输入密码' }]}
            >
              <Input.Password
                prefix={<LockOutlined />}
                placeholder="密码"
              />
            </Form.Item>

            <Form.Item>
              <Button
                type="primary"
                htmlType="submit"
                block
                loading={loading || loginMutation.isPending}
              >
                登录
              </Button>
            </Form.Item>
          </Form>

          <Text type="secondary" style={{ fontSize: 12, textAlign: 'center', display: 'block' }}>
            Mock 模式下任意用户名密码均可登录
          </Text>
        </Space>
      </Card>
    </div>
  );
}
