// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import {
  collectLocalFootprintInventory,
  defaultLocalStoreProfiles,
} from "@/lib/cloud-offload/footprint";

describe("cloud-offload footprint batch20c", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    roots.length = 0;
  });

  it("defaultLocalStoreProfiles expands tilde paths and resolves repo data dir", () => {
    const root = path.join(os.tmpdir(), `footprint-b20c-${randomUUID()}`);
    fs.mkdirSync(path.join(root, "data"), { recursive: true });
    roots.push(root);
    const profiles = defaultLocalStoreProfiles(root);
    const sqlite = profiles.find((p) => p.id === "sqlite-operational");
    expect(sqlite?.path).toBe(path.join(root, "data/conversations.db"));
    const qmd = profiles.find((p) => p.id === "qmd-cache");
    expect(qmd?.path.startsWith(os.homedir())).toBe(true);
  });

  it("collectLocalFootprintInventory marks missing stores and ok pressure for tiny totals", () => {
    const root = path.join(os.tmpdir(), `footprint-inv-${randomUUID()}`);
    fs.mkdirSync(root, { recursive: true });
    roots.push(root);
    const inv = collectLocalFootprintInventory(root);
    expect(inv.pressure).toBe("ok");
    expect(inv.stores.every((s) => s.exists === false || typeof s.sizeBytes === "number")).toBe(true);
    expect(inv.generatedAt).toMatch(/^\d{4}-/);
  });

  it("collectLocalFootprintInventory emits warnings for large permanent stores", () => {
    const root = path.join(os.tmpdir(), `footprint-warn-${randomUUID()}`);
    const dbDir = path.join(root, "data");
    fs.mkdirSync(dbDir, { recursive: true });
    const bigFile = path.join(dbDir, "conversations.db");
    fs.writeFileSync(bigFile, Buffer.alloc(1024 * 1024 * 1024 + 1024));
    roots.push(root);
    const inv = collectLocalFootprintInventory(root);
    expect(inv.warnings.some((w) => w.includes("sqlite-operational"))).toBe(true);
  });
});
