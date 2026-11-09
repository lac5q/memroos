// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

import { collectCollectionFiles, resolveCollectionPaths } from "@/lib/knowledge-collections";

describe("knowledge-collections batch16c — path resolution and empty scans", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    roots.length = 0;
    delete process.env.KNOWLEDGE_BASE_PATH;
  });

  it("resolveCollectionPaths prefixes KNOWLEDGE_BASE_PATH for relative segments", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `kb-b16c-${crypto.randomUUID()}-`));
    roots.push(root);
    process.env.KNOWLEDGE_BASE_PATH = root;
    const paths = resolveCollectionPaths({ name: "docs", basePaths: ["alpha", "/abs/outside"] });
    expect(paths[0]).toBe(path.join(root, "alpha"));
    expect(paths[1]).toBe("/abs/outside");
  });

  it("collectCollectionFiles returns empty list when all base paths are missing", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `kb-empty-b16c-${crypto.randomUUID()}-`));
    roots.push(root);
    process.env.KNOWLEDGE_BASE_PATH = root;
    const files = await collectCollectionFiles({
      name: "missing",
      category: "internal",
      basePaths: ["does-not-exist"],
    });
    expect(files).toEqual([]);
  });
});
