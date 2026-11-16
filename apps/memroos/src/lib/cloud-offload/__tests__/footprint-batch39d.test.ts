// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

import { collectLocalFootprintInventory, defaultLocalStoreProfiles } from "../footprint";

const SANDBOX = path.join(os.tmpdir(), `footprint-b39d-${randomUUID()}`);

afterEach(() => {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("cloud-offload footprint batch39d", () => {
  it("defaultLocalStoreProfiles expands ~/ paths against HOME (homePath 42-44)", () => {
    const home = path.join(SANDBOX, "home");
    fs.mkdirSync(home, { recursive: true });
    const prevHome = process.env.HOME;
    process.env.HOME = home;
    const profiles = defaultLocalStoreProfiles(SANDBOX);
    const qmd = profiles.find((p) => p.id === "qmd-cache");
    expect(qmd?.path).toBe(path.join(home, ".cache", "qmd"));
    process.env.HOME = prevHome;
  });

  it("collectLocalFootprintInventory walks nested service log directories (fileSizeBytes 142-146)", () => {
    const repo = path.join(SANDBOX, "repo-nested-b39d");
    const deep = path.join(repo, "services", "memory", "logs", "nested");
    fs.mkdirSync(deep, { recursive: true });
    fs.writeFileSync(path.join(deep, "leaf-batch39d.log"), Buffer.alloc(24), "utf8");
    const inv = collectLocalFootprintInventory(repo);
    const svcLogs = inv.stores.find((s) => s.id === "memory-service-logs");
    expect(svcLogs?.sizeBytes).toBeGreaterThanOrEqual(24);
  });

  it.skip("fileSizeBytes empty stack.pop guard (146) — while loop never pops an empty stack", () => {});
});