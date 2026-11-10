import { defineConfig } from '@playwright/test'

// End-to-end tests launch the built Electron app (npm run test:e2e builds first).
export default defineConfig({
  testDir: './e2e',
  // Each launch of the real app takes 15–45 s on the owner's Mac (more right after a build, while
  // macOS scans the new binary). Single-launch tests get 90 s; tests that restart the app set their
  // own limit with LAUNCH_BUDGET per launch (see e2e/app.spec.ts).
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
})
