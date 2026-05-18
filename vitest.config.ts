import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'client/src'),
      '@shared': path.resolve(__dirname, 'shared'),
      '@assets': path.resolve(__dirname, 'attached_assets'),
    },
  },
  test: {
    globals: true,
    // Default environment is node; jsdom is applied to client tests only
    environment: 'node',
    environmentMatchGlobs: [
      ['tests/client/**', 'jsdom'],
    ],
    // Safe fake values — prevent modules from throwing on import due to missing env vars.
    // Real DB/Supabase calls are blocked by vi.mock() in each test file.
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://test:test@localhost:5432/testdb',
      SESSION_SECRET: 'test-session-secret-at-least-32-characters-long',
      SUPABASE_URL: 'https://test.supabase.co',
      SUPABASE_ANON_KEY: 'test-anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
    },
    testTimeout: 15000,
  },
});
