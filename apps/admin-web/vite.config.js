import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
    optimizeDeps: {
        include: [
            '@biz-reporting/shared-types',
            '@biz-reporting/shared-constants',
        ],
    },
    build: {
        commonjsOptions: {
            include: [/shared-types/, /shared-constants/, /node_modules/],
        },
    },
    server: {
        port: 5174,
        proxy: {
            '/api': {
                target: 'http://localhost:3000',
                changeOrigin: true,
            },
        },
    },
});
