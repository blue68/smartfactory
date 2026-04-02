import { defineConfig, devices } from '@playwright/test';

const skipWebServer = process.env.PLAYWRIGHT_SKIP_WEBSERVER === '1';

export default defineConfig({
  testMatch: ['**/*.spec.ts'],
  testDir: './tests',
  timeout: 30_000,
  expect: {
    timeout: 5000,
  },
  globalSetup: require.resolve('./playwright.global-setup.ts'),
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: skipWebServer
    ? undefined
    : {
        command: 'npm run dev -- --host 127.0.0.1',
        cwd: 'services/web',
        port: 5173,
        timeout: 120_000,
        reuseExistingServer: !process.env.CI,
      },
});
