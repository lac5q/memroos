// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { collectLocalFootprintInventory, defaultLocalStoreProfiles } from "../footprint";

const SANDBOX = path.join(os.tmpdir(), `footprint-b34-${randomUUID()}`);

afterEach(() => {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

describe("cloud-offload footprint batch34", () => {
  it("homePath expands ~/relative profiles (42-44)", () => {
    const repo = path.join(SANDBOX, "repo-b34");
    fs.mkdirSync(repo, { recursive: true });
    const mem0 = defaultLocalStoreProfiles(repo).find((p) => p.id === "mem0-local-cache");
    expect(mem0?.path).toBe(path.join(os.homedir(), ".mem0"));
    const qmd = defaultLocalStoreProfiles(repo).find((p) => p.id === "qmd-cache");
    expect(qmd?.path).toBe(path.join(os.homedir(), ".cache", "qmd"));
  });

  it("collectLocalFootprintInventory skips unreadable directories (146)", () => {
    const repo = path.join(SANDBOX, "repo-inv-b34");
    const logs = path.join(repo, "services", "memory", "logs");
    fs.mkdirSync(logs, { recursive: true });
    fs.writeFileSync(path.join(logs, "app.log"), "batch34 footprint log\n");
    const secretDir = path.join(logs, "secret-b34");
    fs.mkdirSync(secretDir, { mode: 0o000 });
    try {
      const inventory = collectLocalFootprintInventory(repo);
      expect(inventory.totalBytes).toBeGreaterThanOrEqual(0);
      expect(inventory.stores.some((s) => s.id === "memory-service-logs")).toBe(true);
    } finally {
      fs.chmodSync(secretDir, 0o755);
    }
  });

  it.skip("fileSizeBytes stack guard when pop returns undefined (146) — unreachable without mutating stack", () => {});
});
