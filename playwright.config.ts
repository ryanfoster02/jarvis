import { defineConfig } from '@playwright/test'

// End-to-end tests launch the built Electron app (npm run test:e2e builds first).
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
})
