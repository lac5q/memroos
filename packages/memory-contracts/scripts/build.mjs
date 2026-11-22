import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const statePath = path.join(root, "dist/.build-state.json");
const lockPath = path.join(root, ".build-lock");

function files(directory) {
  return readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return files(relative);
    if (!entry.isFile()) throw new Error("memory-contracts build inputs/outputs must be regular files");
    return relative.endsWith("/.build-state.json") ? [] : [relative];
  });
}

function digest(paths) {
  return createHash("sha256").update(JSON.stringify(paths.sort().map((relative) => [
    relative, createHash("sha256").update(readFileSync(path.join(root, relative))).digest("hex"),
  ]))).digest("hex");
}

function inputs() {
  return digest(["package.json", "tsconfig.json", ...files("scripts"), ...files("src")]);
}

function assertDependencyVersions() {
  const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const expected = manifest.devDependencies.typescript;
  if (require("typescript/package.json").version !== expected) {
    throw new Error("memory-contracts requires its pinned typescript; install workspace dependencies first.");
  }
}

function matchesBuild() {
  try {
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    return state.version === 1 && state.inputs === inputs() && state.outputs === digest(files("dist"));
  } catch { return false; }
}

export function assertFreshBuild() {
  assertDependencyVersions();
  if (existsSync(lockPath) || !matchesBuild()) {
    throw new Error("memory-contracts build is missing or stale; run npm run build:memory-contracts at the repository root (or npm run build in the package).");
  }
}

export function build() {
  assertDependencyVersions();
  const deadline = Date.now() + 30_000;
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  for (;;) {
    try { mkdirSync(lockPath); break; } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (Date.now() >= deadline) {
        throw new Error("Another memory-contracts build is active. If a previous build crashed, remove packages/memory-contracts/.build-lock and retry.");
      }
      Atomics.wait(sleeper, 0, 0, 50);
    }
  }
  try {
    assertDependencyVersions();
    if (matchesBuild()) return;
    const before = inputs();
    rmSync(path.join(root, "dist"), { recursive: true, force: true });
    execFileSync(process.execPath, [require.resolve("typescript/bin/tsc"), "-p", "tsconfig.json"], {
      cwd: root, stdio: "inherit",
    });
    if (before !== inputs()) throw new Error("memory-contracts sources changed during the build; retry.");
    writeFileSync(statePath, JSON.stringify({ version: 1, inputs: before, outputs: digest(files("dist")) }) + "\n");
  } finally {
    rmSync(lockPath, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "--check") assertFreshBuild();
  else if (process.argv.length === 2) build();
  else throw new Error("Usage: node scripts/build.mjs [--check]");
}
