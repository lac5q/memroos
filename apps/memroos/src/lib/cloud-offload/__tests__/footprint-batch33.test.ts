// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { collectLocalFootprintInventory, defaultLocalStoreProfiles } from "../footprint";

const SANDBOX = path.join(os.tmpdir(), `footprint-b33-${randomUUID()}`);

afterEach(() => {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

describe("cloud-offload footprint batch33", () => {
  it("homePath expands ~/ prefixes (42–44)", () => {
    const repo = path.join(SANDBOX, "repo-b33");
    fs.mkdirSync(repo, { recursive: true });
    const profiles = defaultLocalStoreProfiles(repo);
    expect(profiles.find((p) => p.id === "qmd-cache")?.path).toBe(path.join(os.homedir(), ".cache", "qmd"));
    expect(profiles.find((p) => p.id === "mem0-local-cache")?.path).toBe(path.join(os.homedir(), ".mem0"));
  });

  it("fileSizeBytes handles empty directory stacks (146)", () => {
    const repo = path.join(SANDBOX, "repo-empty-b33");
    const logs = path.join(repo, "services", "memory", "logs");
    fs.mkdirSync(logs, { recursive: true });
    const inv = collectLocalFootprintInventory(repo);
    expect(inv.stores.find((s) => s.id === "memory-service-logs")?.sizeBytes).toBe(0);
  });
});
