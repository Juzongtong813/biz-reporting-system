import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import AuthGuard from '@/components/AuthGuard';
import AdminLayout from '@/components/AdminLayout';

const Login = lazy(() => import('@/pages/Login'));
const Dashboard = lazy(() => import('@/pages/Dashboard'));
const Contracts = lazy(() => import('@/pages/Contracts'));
const Packages = lazy(() => import('@/pages/Packages'));
const Users = lazy(() => import('@/pages/Users'));

function PageLoading() {
  return <div style={{ textAlign: 'center', padding: 100 }}>加载中...</div>;
}

function AdminRoutes() {
  return (
    <AdminLayout>
      <Suspense fallback={<PageLoading />}>
        <Routes>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/contracts" element={<Contracts />} />
          <Route path="/packages" element={<Packages />} />
          <Route path="/users" element={<Users />} />
          <Route path="*" element={<Navigate to="/admin/dashboard" replace />} />
        </Routes>
      </Suspense>
    </AdminLayout>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/login"
          element={
            <Suspense fallback={<PageLoading />}>
              <Login />
            </Suspense>
          }
        />
        <Route
          path="/admin"
          element={
            <AuthGuard>
              <AdminRoutes />
            </AuthGuard>
          }
        />
        <Route path="/" element={<Navigate to="/admin/dashboard" replace />} />
        <Route path="*" element={<Navigate to="/admin/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
