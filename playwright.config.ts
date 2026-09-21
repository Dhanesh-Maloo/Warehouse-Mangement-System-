import { defineConfig, devices } from '@playwright/test';

// E2E tests exercise the real web app against the real API — both dev
// servers must already be running (`pnpm dev`) against a migrated + seeded
// database. We don't auto-start them here because doing so would also
// require managing the Postgres/LocalStack containers and DB state, which
// belongs to whoever owns the environment, not to the test run itself.
export default defineConfig({
  testDir: './apps/web/e2e',
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
