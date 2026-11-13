// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

import { collectLocalFootprintInventory, defaultLocalStoreProfiles } from "../footprint";

const ROOT = path.join(os.tmpdir(), `footprint-b19-${crypto.randomUUID()}`);

afterEach(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
});

describe("cloud-offload footprint batch19", () => {
  it("defaultLocalStoreProfiles expands home-relative paths", () => {
    const profiles = defaultLocalStoreProfiles(ROOT);
    const qmd = profiles.find((profile) => profile.id === "qmd-cache");
    expect(qmd?.path.startsWith(os.homedir())).toBe(true);
    expect(profiles.some((profile) => profile.path === path.join(ROOT, "data/conversations.db"))).toBe(
      true,
    );
  });

  it("collectLocalFootprintInventory sums nested directories and ignores unreadable children", () => {
    const dataDir = path.join(ROOT, "data");
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, "conversations.db"), "sqlite-bytes", "utf8");
    const blocked = path.join(dataDir, "blocked-dir");
    fs.mkdirSync(blocked);
    fs.writeFileSync(path.join(blocked, "secret.bin"), "1234567890", "utf8");
    fs.chmodSync(blocked, 0o000);

    const inventory = collectLocalFootprintInventory(ROOT);
    const sqlite = inventory.stores.find((store) => store.id === "sqlite-operational");
    expect(sqlite?.exists).toBe(true);
    expect(sqlite?.sizeBytes).toBeGreaterThan(0);

    fs.chmodSync(blocked, 0o700);
  });

  it("collectLocalFootprintInventory skips missing store paths gracefully", () => {
    const inventory = collectLocalFootprintInventory(path.join(ROOT, "missing-repo"));
    expect(inventory.totalBytes).toBeGreaterThanOrEqual(0);
    expect(inventory.stores.every((store) => typeof store.sizeBytes === "number")).toBe(true);
  });
});
