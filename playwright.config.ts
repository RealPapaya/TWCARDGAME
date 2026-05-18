import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./docs",
  testMatch: "phase4-verify.spec.ts",
  timeout: 60_000,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://localhost:5173",
    headless: true,
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
