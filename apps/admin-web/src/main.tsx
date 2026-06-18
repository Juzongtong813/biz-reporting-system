import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import './App.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

async function bootstrap() {
  // MSW 条件启动（仅在开发环境 + VITE_ENABLE_MSW=true 时生效）
  if (
    import.meta.env.DEV &&
    import.meta.env.VITE_ENABLE_MSW === 'true'
  ) {
    const { worker } = await import('./mocks/browser');
    await worker.start({ onUnhandledRequest: 'bypass' });
    console.log('[MSW] Mock Service Worker 已启动');
  }

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <ConfigProvider locale={zhCN}>
          <App />
        </ConfigProvider>
      </QueryClientProvider>
    </React.StrictMode>,
  );
}

bootstrap();
