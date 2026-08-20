// @ts-check
const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests",
  timeout: 10000,
  use: {
    browserName: "chromium",
    viewport: { width: 1280, height: 900 }
  }
});
