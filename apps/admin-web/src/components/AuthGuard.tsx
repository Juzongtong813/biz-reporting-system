/**
 * AuthGuard — 路由守卫组件
 *
 * 未登录时重定向到 /login，已登录时渲染子组件。
 * 配合 React Router v6 嵌套路由使用（包裹 protected layout route）。
 */
import { Navigate } from 'react-router-dom';
import { isAuthenticated } from '@/utils/auth';

interface AuthGuardProps {
  children: React.ReactNode;
}

export default function AuthGuard({ children }: AuthGuardProps) {
  if (!isAuthenticated()) {
    // replace 避免登录后返回时出现历史记录问题
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
