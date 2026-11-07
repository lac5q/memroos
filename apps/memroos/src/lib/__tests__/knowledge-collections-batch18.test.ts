// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

import {
  collectCollectionFiles,
  loadCollections,
  resolveCollectionPath,
  scanCollection,
} from "@/lib/knowledge-collections";

describe("knowledge-collections batch18 — resolveCollectionPath and scan edges", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    roots.length = 0;
    delete process.env.KNOWLEDGE_BASE_PATH;
    delete process.env.COLLECTIONS_CONFIG_PATH;
  });

  it("resolveCollectionPath returns the first resolved base path", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `kb-b18-${randomUUID()}-`));
    roots.push(root);
    process.env.KNOWLEDGE_BASE_PATH = root;
    const resolved = resolveCollectionPath({
      name: "docs",
      basePaths: ["alpha", "beta"],
    });
    expect(resolved).toBe(path.join(root, "alpha"));
  });

  it("scanCollection returns null lastUpdated when the directory is empty", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `kb-empty-b18-${randomUUID()}-`));
    roots.push(root);
    const emptyDir = path.join(root, "empty");
    fs.mkdirSync(emptyDir, { recursive: true });
    const scan = await scanCollection(emptyDir);
    expect(scan.docCount).toBe(0);
    expect(scan.lastUpdated).toBeNull();
  });

  it("loadCollections returns an empty list when the config file is missing", () => {
    process.env.COLLECTIONS_CONFIG_PATH = path.join(os.tmpdir(), `missing-collections-${randomUUID()}.json`);
    expect(loadCollections()).toEqual([]);
  });

  it("collectCollectionFiles ignores ENOTDIR base paths that point at files", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `kb-err-b18-${randomUUID()}-`));
    roots.push(root);
    process.env.KNOWLEDGE_BASE_PATH = root;
    fs.writeFileSync(path.join(root, "not-a-dir"), "plain file", "utf8");
    const files = await collectCollectionFiles({
      name: "broken",
      category: "internal",
      basePaths: ["not-a-dir"],
    });
    expect(files).toEqual([]);
  });
});
