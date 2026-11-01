// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { collectLocalFootprintInventory, defaultLocalStoreProfiles } from "../footprint";

describe("cloud-offload footprint batch22", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    roots.length = 0;
  });

  it("defaultLocalStoreProfiles resolves absolute repo paths and home-relative tilde prefixes", () => {
    const root = path.join(os.tmpdir(), `footprint-b22-${crypto.randomUUID()}`);
    fs.mkdirSync(path.join(root, "data"), { recursive: true });
    roots.push(root);
    const profiles = defaultLocalStoreProfiles(root);
    const sqlite = profiles.find((p) => p.id === "sqlite-operational");
    expect(path.isAbsolute(sqlite?.path ?? "")).toBe(true);
    expect(sqlite?.path).toBe(path.join(root, "data/conversations.db"));
    const runtime = profiles.find((p) => p.id === "runtime-env");
    expect(runtime?.path.startsWith(os.homedir())).toBe(true);
  });

  it("fileSizeBytes returns zero when statSync throws for a store path", () => {
    const root = path.join(os.tmpdir(), `footprint-stat-${crypto.randomUUID()}`);
    const dataDir = path.join(root, "data");
    fs.mkdirSync(dataDir, { recursive: true });
    const dbFile = path.join(dataDir, "conversations.db");
    fs.writeFileSync(dbFile, "payload", "utf8");
    roots.push(root);
    const realStat = fs.statSync.bind(fs);
    vi.spyOn(fs, "statSync").mockImplementation((target: fs.PathLike) => {
      if (String(target) === dbFile) {
        throw new Error("stat denied batch22");
      }
      return realStat(target);
    });
    const inv = collectLocalFootprintInventory(root);
    const sqlite = inv.stores.find((s) => s.id === "sqlite-operational");
    expect(sqlite?.exists).toBe(true);
    expect(sqlite?.sizeBytes).toBe(0);
    vi.restoreAllMocks();
  });

  it("collectLocalFootprintInventory reports critical pressure when permanent store exceeds critical limit", () => {
    const root = path.join(os.tmpdir(), `footprint-critical-${crypto.randomUUID()}`);
    const dataDir = path.join(root, "data");
    fs.mkdirSync(dataDir, { recursive: true });
    const bigFile = path.join(dataDir, "conversations.db");
    const criticalSize = 5 * 1024 * 1024 * 1024 + 4096;
    const fd = fs.openSync(bigFile, "w");
    fs.ftruncateSync(fd, criticalSize);
    fs.closeSync(fd);
    roots.push(root);
    const inv = collectLocalFootprintInventory(root);
    expect(inv.pressure).toBe("critical");
    expect(inv.totalBytes).toBeGreaterThanOrEqual(5 * 1024 * 1024 * 1024);
  });
});
