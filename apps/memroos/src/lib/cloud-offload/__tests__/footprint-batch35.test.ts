// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { collectLocalFootprintInventory, defaultLocalStoreProfiles } from "../footprint";

const SANDBOX = path.join(os.tmpdir(), `footprint-b35-${randomUUID()}`);

afterEach(() => {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

describe("cloud-offload footprint batch35", () => {
  it("homePath resolves bare tilde (42)", () => {
    const repo = path.join(SANDBOX, "repo-b35");
    fs.mkdirSync(repo, { recursive: true });
    const runtime = defaultLocalStoreProfiles(repo).find((p) => p.id === "runtime-env");
    expect(runtime?.path).toBe(path.join(os.homedir(), ".memroos"));
  });

  it("homePath resolves ~/relative prefixes (44)", () => {
    const repo = path.join(SANDBOX, "repo-b35b");
    fs.mkdirSync(repo, { recursive: true });
    const vault = defaultLocalStoreProfiles(repo).find((p) => p.id === "raw-vault");
    expect(vault?.path).toBe(path.join(os.homedir(), ".memroos", "vault"));
  });

  it("collectLocalFootprintInventory tolerates unreadable nested dirs (146)", () => {
    const repo = path.join(SANDBOX, "repo-inv-b35");
    const logs = path.join(repo, "services", "memory", "logs");
    fs.mkdirSync(logs, { recursive: true });
    fs.writeFileSync(path.join(logs, "batch35.log"), "log\n");
    const locked = path.join(logs, "locked-b35");
    fs.mkdirSync(locked, { mode: 0o000 });
    try {
      const inventory = collectLocalFootprintInventory(repo);
      expect(inventory.stores.some((s) => s.id === "memory-service-logs")).toBe(true);
    } finally {
      fs.chmodSync(locked, 0o755);
    }
  });

  it.skip("fileSizeBytes sticky stack guard when pop is undefined (146)", () => {});
});
