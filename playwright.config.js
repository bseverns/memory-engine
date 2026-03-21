const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { defineConfig, devices } = require("@playwright/test");
const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:8000";
const disableWebServer = process.env.PLAYWRIGHT_DISABLE_WEBSERVER === "1";

function findDownloadedChromiumExecutable() {
  const cacheRoot = path.join(os.homedir(), "Library", "Caches", "ms-playwright");
  if (!fs.existsSync(cacheRoot)) {
    return undefined;
  }

  const candidateDirs = fs.readdirSync(cacheRoot)
    .filter((entry) => entry.startsWith("chromium-"))
    .sort()
    .reverse();

  for (const dir of candidateDirs) {
    const executable = path.join(
      cacheRoot,
      dir,
      "chrome-mac-arm64",
      "Google Chrome for Testing.app",
      "Contents",
      "MacOS",
      "Google Chrome for Testing",
    );
    if (fs.existsSync(executable)) {
      return executable;
    }
  }

  return undefined;
}

const downloadedChromiumExecutable = findDownloadedChromiumExecutable();

module.exports = defineConfig({
  testDir: "./browser-tests",
  timeout: 30_000,
  fullyParallel: false,
  reporter: [["list"]],
  outputDir: "test-results/playwright",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: disableWebServer ? undefined : {
    command: "/bin/sh -c 'PATH=\"$(pwd)/.venv/bin:$PATH\" python api/manage.py migrate --noinput --settings memory_engine.settings_browser && PATH=\"$(pwd)/.venv/bin:$PATH\" python api/manage.py runserver 127.0.0.1:8000 --noreload --settings memory_engine.settings_browser'",
    url: "http://127.0.0.1:8000/kiosk/",
    reuseExistingServer: true,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      DJANGO_SETTINGS_MODULE: "memory_engine.settings_browser",
    },
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: downloadedChromiumExecutable
          ? { executablePath: downloadedChromiumExecutable }
          : {},
      },
    },
  ],
});
