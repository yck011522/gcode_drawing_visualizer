// @ts-check
const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests",
  timeout: 10000,
  webServer: {
    command: "npm run serve",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI
  },
  use: {
    browserName: "chromium",
    baseURL: "http://127.0.0.1:4173",
    viewport: { width: 1280, height: 900 }
  }
});
