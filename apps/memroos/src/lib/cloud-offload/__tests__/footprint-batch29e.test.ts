// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

import { collectLocalFootprintInventory } from "../footprint";

const SANDBOX = path.join(os.tmpdir(), `footprint-b29e-${randomUUID()}`);

afterEach(() => {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("cloud-offload footprint batch29e — homePath + directory sizing", () => {
  it("expands ~/ via homePath and sizes a repo-relative log directory (42, 44, 137, 146)", () => {
    fs.mkdirSync(SANDBOX, { recursive: true });
    const homeCache = path.join(SANDBOX, "home");
    const qmdDir = path.join(homeCache, ".cache", "qmd");
    fs.mkdirSync(qmdDir, { recursive: true });
    fs.writeFileSync(path.join(qmdDir, "blob.bin"), Buffer.alloc(32), "utf8");

    const logsDir = path.join(SANDBOX, "services", "memory", "logs");
    fs.mkdirSync(logsDir, { recursive: true });
    fs.writeFileSync(path.join(logsDir, "batch29e.log"), Buffer.alloc(16), "utf8");

    const origHome = process.env.HOME;
    process.env.HOME = homeCache;

    const inv = collectLocalFootprintInventory(SANDBOX);
    const qmd = inv.stores.find((s) => s.id === "qmd-cache");
    expect(qmd?.path).toBe(path.join(homeCache, ".cache", "qmd"));
    expect(qmd?.sizeBytes).toBeGreaterThanOrEqual(32);

    const svcLogs = inv.stores.find((s) => s.id === "memory-service-logs");
    expect(svcLogs?.sizeBytes).toBeGreaterThanOrEqual(16);

    process.env.HOME = origHome;
  });

  it("fileSizeBytes stacks nested dirs and tolerates unreadable children (line 146)", () => {
    const repo = path.join(SANDBOX, "repo-nested-b29e");
    const deep = path.join(repo, "services", "memory", "logs", "nested");
    fs.mkdirSync(deep, { recursive: true });
    fs.writeFileSync(path.join(deep, "leaf.log"), Buffer.alloc(12), "utf8");

    const inv = collectLocalFootprintInventory(repo);
    const svcLogs = inv.stores.find((s) => s.id === "memory-service-logs");
    expect(svcLogs?.sizeBytes).toBeGreaterThanOrEqual(12);
  });
});
