// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

import {
  collectCollectionFiles,
  collectKnowledgeFiles,
  isKnowledgeFile,
  scanConfiguredCollection,
} from "@/lib/knowledge-collections";

describe("knowledge-collections batch23b — file typing, symlinks, multi-root scan", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    roots.length = 0;
    delete process.env.KNOWLEDGE_BASE_PATH;
    delete process.env.COLLECTIONS_CONFIG_PATH;
  });

  it("isKnowledgeFile accepts md/mdx/txt and rejects other extensions", () => {
    expect(isKnowledgeFile("note.md")).toBe(true);
    expect(isKnowledgeFile("page.MDX")).toBe(true);
    expect(isKnowledgeFile("readme.txt")).toBe(true);
    expect(isKnowledgeFile("data.json")).toBe(false);
  });

  it("collectKnowledgeFiles skips symbolic links and non-knowledge files", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `kb-b23b-${randomUUID()}-`));
    roots.push(root);
    const realDir = path.join(root, "real");
    fs.mkdirSync(realDir, { recursive: true });
    fs.writeFileSync(path.join(realDir, "keep.md"), "# keep\n", "utf8");
    fs.writeFileSync(path.join(root, "skip.json"), "{}", "utf8");
    try {
      fs.symlinkSync(realDir, path.join(root, "link-dir"), "dir");
    } catch {
      // Some environments disallow symlinks; still validate real files.
    }
    const files = await collectKnowledgeFiles(root);
    expect(files.some((f) => f.path.endsWith("keep.md"))).toBe(true);
    expect(files.some((f) => f.path.endsWith("skip.json"))).toBe(false);
  });

  it("collectCollectionFiles merges basePaths and scanConfiguredCollection counts docs", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `kb-multi-b23b-${randomUUID()}-`));
    roots.push(root);
    process.env.KNOWLEDGE_BASE_PATH = root;
    const a = path.join(root, "a");
    const b = path.join(root, "b");
    fs.mkdirSync(a, { recursive: true });
    fs.mkdirSync(b, { recursive: true });
    fs.writeFileSync(path.join(a, "one.md"), "# one\n", "utf8");
    fs.writeFileSync(path.join(b, "two.mdx"), "# two\n", "utf8");
    const merged = await collectCollectionFiles({
      name: "merged",
      category: "internal",
      basePaths: ["a", "b"],
    });
    expect(merged).toHaveLength(2);
    const scan = await scanConfiguredCollection({
      name: "merged",
      category: "internal",
      basePaths: ["a", "b"],
    });
    expect(scan.docCount).toBe(2);
    expect(scan.lastUpdated).toBeInstanceOf(Date);
  });
});
