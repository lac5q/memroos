// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { collectLocalFootprintInventory, defaultLocalStoreProfiles } from "../footprint";

const SANDBOX = path.join(os.tmpdir(), `footprint-b31-${randomUUID()}`);

afterEach(() => {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

describe("cloud-offload footprint batch31", () => {
  it("homePath expands bare ~ and ~/ prefixes (lines 42–44)", () => {
    const repo = path.join(SANDBOX, "repo-b31");
    fs.mkdirSync(repo, { recursive: true });
    const profiles = defaultLocalStoreProfiles(repo);
    const qmd = profiles.find((p) => p.id === "qmd-cache");
    const mem0 = profiles.find((p) => p.id === "mem0-local-cache");
    expect(qmd?.path).toBe(path.join(os.homedir(), ".cache", "qmd"));
    expect(mem0?.path).toBe(path.join(os.homedir(), ".mem0"));
  });

  it("fileSizeBytes skips empty stack pops (line 146)", () => {
    const repo = path.join(SANDBOX, "repo-empty-stack-b31");
    const logs = path.join(repo, "services", "memory", "logs");
    fs.mkdirSync(logs, { recursive: true });
    const inv = collectLocalFootprintInventory(repo);
    const svcLogs = inv.stores.find((s) => s.id === "memory-service-logs");
    expect(svcLogs?.sizeBytes).toBe(0);
  });
});
