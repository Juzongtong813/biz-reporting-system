import { useMemo, useState } from 'react';
import { Alert, Button, Checkbox, Form, Input, Typography } from 'antd';
import { LockOutlined, LoginOutlined, SafetyOutlined, UserOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { bizLogin } from '@/api/biz.api';
import { setBizToken } from '@/utils/biz-auth';
import './BizLogin.css';

const { Title, Text } = Typography;
const REMEMBERED_USERNAME_KEY = 'biz-login-remembered-username';

interface LoginValues {
  username: string;
  password: string;
  rememberUsername?: boolean;
}

function readRememberedUsername(): string {
  try {
    return localStorage.getItem(REMEMBERED_USERNAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export default function BizLogin() {
  const navigate = useNavigate();
  const rememberedUsername = useMemo(readRememberedUsername, []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFinish = async (values: LoginValues) => {
    setLoading(true);
    setError(null);
    try {
      const username = values.username.trim();
      const result = await bizLogin(username, values.password);
      setBizToken(result.accessToken);
      try {
        if (values.rememberUsername) localStorage.setItem(REMEMBERED_USERNAME_KEY, username);
        else localStorage.removeItem(REMEMBERED_USERNAME_KEY);
      } catch {
        // Storage may be disabled in a private browser window; login still succeeds.
      }
      navigate('/biz/portal', { replace: true });
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { message?: string | string[] } } }).response?.data?.message;
      setError(Array.isArray(detail) ? detail.join('；') : (detail ?? '登录失败，请检查账号和密码'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="biz-login-page">
      <section className="biz-login-shell" aria-label="经营数据中台登录">
        <div className="biz-login-brand-panel">
          <header className="biz-login-company">
            <span className="biz-login-logo"><img src={`${import.meta.env.BASE_URL}logo.jpg`} alt="中屹技术有限公司" /></span>
            <strong>中屹技术有限公司</strong>
          </header>
          <div className="biz-login-brand-copy">
            <span>经营协同 · 数据治理</span>
            <Title level={1}>中屹技术欢迎您</Title>
            <Text>低调、谨慎、务实</Text>
          </div>
          <Text className="biz-login-trust"><SafetyOutlined /> 身份验证与业务权限由系统统一管理</Text>
        </div>

        <div className="biz-login-form-panel">
          <header className="biz-login-form-heading">
            <span>经营数据中台</span>
            <Title level={2}>登录工作台</Title>
            <Text>请输入系统管理员分配的账号和密码</Text>
          </header>
          {error && <Alert className="biz-login-alert" type="error" showIcon message={error} closable onClose={() => setError(null)} />}
          <Form<LoginValues>
            layout="vertical"
            requiredMark={false}
            initialValues={{ username: rememberedUsername, rememberUsername: Boolean(rememberedUsername) }}
            onFinish={onFinish}
            disabled={loading}
            autoComplete="on"
          >
            <Form.Item name="username" label="账号" rules={[{ required: true, whitespace: true, message: '请输入账号' }]}>
              <Input data-testid="biz-login-username" prefix={<UserOutlined />} placeholder="请输入用户名" autoComplete="username" maxLength={80} />
            </Form.Item>
            <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
              <Input.Password data-testid="biz-login-password" prefix={<LockOutlined />} placeholder="请输入密码" autoComplete="current-password" />
            </Form.Item>
            <Form.Item name="rememberUsername" valuePropName="checked" className="biz-login-remember">
              <Checkbox>记住账号</Checkbox>
            </Form.Item>
            <Button data-testid="biz-login-submit" className="biz-login-submit" type="primary" htmlType="submit" block loading={loading} icon={<LoginOutlined />}>
              登录
            </Button>
          </Form>
          <p className="biz-login-note">仅限获授权人员使用，操作将记录至审计日志</p>
        </div>
      </section>
      <footer className="biz-login-footer">中屹技术有限公司 · 内部业务系统</footer>
    </main>
  );
}
