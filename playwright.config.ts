import { defineConfig } from '@playwright/test'

// End-to-end tests launch the built Electron app (npm run test:e2e builds first).
export default defineConfig({
  testDir: './e2e',
  // Each launch of the real app takes several seconds, and the first launch after a build also
  // waits for macOS's one-time security scan of the new binary.
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
})
