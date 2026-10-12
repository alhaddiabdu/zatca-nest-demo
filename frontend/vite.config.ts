import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// في التطوير المحلي (npm run dev) تُحوَّل طلبات /zatca إلى خادم NestJS
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    proxy: { '/zatca': process.env.API_URL ?? 'http://localhost:3010' },
  },
});
