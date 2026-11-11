// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

import { collectLocalFootprintInventory, defaultLocalStoreProfiles } from "../footprint";

const SANDBOX = path.join(os.tmpdir(), `footprint-b30-${randomUUID()}`);

afterEach(() => {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

describe("cloud-offload footprint batch30", () => {
  it("homePath resolves bare ~ and treats non-file non-dir stats as zero bytes (42, 137)", () => {
    const repo = path.join(SANDBOX, "repo-foot-b30");
    const dbPath = path.join(repo, "data", "conversations.db");
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    fs.writeFileSync(dbPath, "sqlite-batch30");

    const profiles = defaultLocalStoreProfiles(repo);
    const qmd = profiles.find((p) => p.id === "qmd-cache");
    expect(qmd?.path).toBe(path.join(os.homedir(), ".cache", "qmd"));

    const originalStat = fs.statSync.bind(fs);
    vi.spyOn(fs, "statSync").mockImplementation((target) => {
      if (String(target) === dbPath) {
        return { isFile: () => false, isDirectory: () => false } as fs.Stats;
      }
      return originalStat(target);
    });
    const inv = collectLocalFootprintInventory(repo);
    expect(inv.stores.find((s) => s.id === "sqlite-operational")?.sizeBytes).toBe(0);
    vi.restoreAllMocks();
  });

  it("tolerates unreadable directory children while sizing logs (146)", () => {
    const repo = path.join(SANDBOX, "repo-unreadable-b30");
    const logs = path.join(repo, "services", "memory", "logs");
    fs.mkdirSync(logs, { recursive: true });
    fs.writeFileSync(path.join(logs, "ok.log"), Buffer.alloc(8));
    fs.chmodSync(logs, 0o000);

    const inv = collectLocalFootprintInventory(repo);
    const svcLogs = inv.stores.find((s) => s.id === "memory-service-logs");
    expect(svcLogs?.sizeBytes).toBeGreaterThanOrEqual(0);

    fs.chmodSync(logs, 0o755);
  });
});
