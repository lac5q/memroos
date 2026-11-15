// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import { collectLocalFootprintInventory, defaultLocalStoreProfiles } from "../footprint";

describe("cloud-offload footprint batch38b", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    roots.length = 0;
  });

  it.skip("homePath exact tilde (42) — no caller passes bare ~", () => {});

  it("defaultLocalStoreProfiles expands ~/ cache paths via homePath (44)", () => {
    const root = path.join(os.tmpdir(), `footprint-b38b-${randomUUID()}`);
    fs.mkdirSync(path.join(root, "data"), { recursive: true });
    roots.push(root);
    const profiles = defaultLocalStoreProfiles(root);
    const qmd = profiles.find((p) => p.id === "qmd-cache");
    expect(qmd?.path).toBe(path.join(os.homedir(), ".cache/qmd"));
    expect(collectLocalFootprintInventory(root).stores.some((s) => s.id === "qmd-cache")).toBe(true);
  });

  it("fileSizeBytes walks nested files under an existing directory (146 adjacent)", () => {
    const root = path.join(os.tmpdir(), `footprint-walk-b38b-${randomUUID()}`);
    const nested = path.join(root, "data", "nested");
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(nested, "leaf.txt"), "batch38b-footprint", "utf8");
    roots.push(root);
    const inv = collectLocalFootprintInventory(root);
    const walDir = inv.stores.find((s) => s.id === "sqlite-wal-shm");
    expect(walDir?.sizeBytes).toBeGreaterThan(0);
  });

  it.skip("fileSizeBytes stack.pop guard (146) — unreachable while stack.length > 0", () => {});
});