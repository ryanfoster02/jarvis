import { defineConfig } from '@playwright/test'

// End-to-end tests launch the built Electron app (npm run test:e2e builds first).
export default defineConfig({
  testDir: './e2e',
  // Each launch of the real app takes 8–45 s on the owner's Mac. Single-launch tests get 2 minutes;
  // tests that restart the app set their own limit with LAUNCH_BUDGET per launch (e2e/electron.ts).
  timeout: 120_000,
  // One warm-up launch before the tests absorbs the slow first start after a build.
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
})
