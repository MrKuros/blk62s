import { defineConfig, devices } from '@playwright/test'

const CI = !!process.env.CI

// Production build against the real API. The January views read the bundled snapshot, so this runs offline.
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: 'http://localhost:4173', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'uv run uvicorn main:app --port 8000',
      cwd: '../backend',
      url: 'http://localhost:8000/api/v1/meta',
      reuseExistingServer: !CI,
      timeout: 180_000,
    },
    {
      command: 'pnpm build && pnpm preview --port 4173 --strictPort',
      url: 'http://localhost:4173',
      reuseExistingServer: !CI,
      timeout: 180_000,
    },
  ],
})
