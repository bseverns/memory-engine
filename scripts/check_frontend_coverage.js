#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..");
const testDir = path.join(repoRoot, "frontend-tests");
const outputPath = path.join(repoRoot, "test-results", "coverage", "node-coverage-summary.json");

const thresholds = {
  lines: 50,
  branches: 50,
  functions: 45,
};

function listFrontendTests() {
  return fs.readdirSync(testDir)
    .filter((entry) => entry.endsWith(".test.js"))
    .sort()
    .map((entry) => path.join("frontend-tests", entry));
}

function stripAnsi(text) {
  return String(text || "").replace(/\u001b\[[0-9;]*m/g, "");
}

function parseCoverageSummary(rawOutput) {
  const cleaned = stripAnsi(rawOutput);
  const match = cleaned.match(/all files\s+\|\s+([0-9.]+)\s+\|\s+([0-9.]+)\s+\|\s+([0-9.]+)/i);
  if (!match) {
    throw new Error("Could not find the frontend coverage summary in the Node test output.");
  }
  return {
    lines: Number.parseFloat(match[1]),
    branches: Number.parseFloat(match[2]),
    functions: Number.parseFloat(match[3]),
  };
}

function ensureOutputDir() {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
}

function writeSummary(summary) {
  ensureOutputDir();
  fs.writeFileSync(outputPath, `${JSON.stringify({
    thresholds,
    summary,
  }, null, 2)}\n`);
}

function enforceThresholds(summary) {
  const failures = Object.entries(thresholds)
    .filter(([key, minimum]) => Number(summary[key] || 0) < minimum)
    .map(([key, minimum]) => `${key} ${summary[key].toFixed(2)}% < ${minimum}%`);

  if (failures.length) {
    throw new Error(`Frontend coverage threshold failed: ${failures.join(", ")}`);
  }
}

async function main() {
  const testFiles = listFrontendTests();
  if (!testFiles.length) {
    throw new Error("No frontend test files were found.");
  }

  const child = spawn(process.execPath, [
    "--test",
    "--experimental-test-coverage",
    ...testFiles,
  ], {
    cwd: repoRoot,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let combinedOutput = "";

  child.stdout.on("data", (chunk) => {
    const text = String(chunk);
    combinedOutput += text;
    process.stdout.write(text);
  });

  child.stderr.on("data", (chunk) => {
    const text = String(chunk);
    combinedOutput += text;
    process.stderr.write(text);
  });

  const exitCode = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });

  if (exitCode !== 0) {
    process.exit(exitCode || 1);
  }

  const summary = parseCoverageSummary(combinedOutput);
  writeSummary(summary);
  enforceThresholds(summary);
  process.stdout.write(
    `Frontend coverage thresholds passed: lines ${summary.lines.toFixed(2)}%, branches ${summary.branches.toFixed(2)}%, functions ${summary.functions.toFixed(2)}%.\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
