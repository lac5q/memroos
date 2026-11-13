// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { collectLocalFootprintInventory, defaultLocalStoreProfiles } from "../footprint";

const SANDBOX = path.join(os.tmpdir(), `footprint-b36-${randomUUID()}`);

afterEach(() => {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

describe("cloud-offload footprint batch36", () => {
  it("homePath resolves bare tilde for runtime-env (42)", () => {
    const repo = path.join(SANDBOX, "repo-b36-tilde");
    fs.mkdirSync(repo, { recursive: true });
    const runtime = defaultLocalStoreProfiles(repo).find((p) => p.id === "runtime-env");
    expect(runtime?.path).toBe(path.join(os.homedir(), ".memroos"));
  });

  it("homePath resolves ~/prefix paths for mem0 cache (44)", () => {
    const repo = path.join(SANDBOX, "repo-b36-prefix");
    fs.mkdirSync(repo, { recursive: true });
    const mem0 = defaultLocalStoreProfiles(repo).find((p) => p.id === "mem0-local-cache");
    expect(mem0?.path).toBe(path.join(os.homedir(), ".mem0"));
  });

  it("collectLocalFootprintInventory walks nested dirs with permission errors (146)", () => {
    const repo = path.join(SANDBOX, "repo-inv-b36");
    const logs = path.join(repo, "services", "memory", "logs");
    fs.mkdirSync(logs, { recursive: true });
    fs.writeFileSync(path.join(logs, "batch36.log"), "entry\n");
    const denied = path.join(logs, "denied-b36");
    fs.mkdirSync(denied, { mode: 0o000 });
    try {
      const inventory = collectLocalFootprintInventory(repo);
      const store = inventory.stores.find((s) => s.id === "memory-service-logs");
      expect(store?.exists).toBe(true);
      expect(store?.sizeBytes).toBeGreaterThan(0);
    } finally {
      fs.chmodSync(denied, 0o755);
    }
  });

  it.skip("fileSizeBytes empty-stack pop guard (146) — unreachable without mocking private walker", () => {});
});
