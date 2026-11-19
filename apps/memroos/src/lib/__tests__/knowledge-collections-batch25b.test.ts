// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

import {
  getKnowledgeBasePath,
  isKnowledgeFile,
  loadCollections,
  resolveCollectionPaths,
} from "@/lib/knowledge-collections";

describe("knowledge-collections batch25b — path helpers", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    roots.length = 0;
    delete process.env.KNOWLEDGE_BASE_PATH;
  });

  it("isKnowledgeFile accepts markdown-family extensions only", () => {
    expect(isKnowledgeFile("notes.md")).toBe(true);
    expect(isKnowledgeFile("page.MDX")).toBe(true);
    expect(isKnowledgeFile("readme.txt")).toBe(true);
    expect(isKnowledgeFile("image.png")).toBe(false);
  });

  it("resolveCollectionPaths merges basePath and basePaths under KNOWLEDGE_BASE_PATH", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `kb-path-b25b-${randomUUID()}-`));
    roots.push(root);
    process.env.KNOWLEDGE_BASE_PATH = root;
    const paths = resolveCollectionPaths({
      name: "docs",
      category: "internal",
      basePaths: ["alpha", "beta"],
    });
    expect(paths).toHaveLength(2);
    expect(paths.every((p) => p.startsWith(root))).toBe(true);
    expect(getKnowledgeBasePath()).toBe(root);
    expect(Array.isArray(loadCollections())).toBe(true);
  });
});
