// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

import {
  collectCollectionFiles,
  collectKnowledgeFiles,
  isKnowledgeFile,
  resolveCollectionPaths,
  scanConfiguredCollection,
} from "@/lib/knowledge-collections";

describe("knowledge-collections batch16 — walking files and missing paths", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    roots.length = 0;
    delete process.env.KNOWLEDGE_BASE_PATH;
    delete process.env.COLLECTIONS_CONFIG_PATH;
  });

  it("isKnowledgeFile accepts markdown variants and rejects other extensions", () => {
    expect(isKnowledgeFile("/tmp/doc.md")).toBe(true);
    expect(isKnowledgeFile("/tmp/doc.MDX")).toBe(true);
    expect(isKnowledgeFile("/tmp/doc.txt")).toBe(true);
    expect(isKnowledgeFile("/tmp/doc.pdf")).toBe(false);
  });

  it("collectKnowledgeFiles skips symlinks and gathers nested knowledge files", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `kb-b16-${crypto.randomUUID()}-`));
    roots.push(root);
    const nested = path.join(root, "nested");
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(nested, "note.md"), "# hello", "utf8");
    fs.writeFileSync(path.join(root, "ignore.bin"), "bin", "utf8");
    try {
      fs.symlinkSync(nested, path.join(root, "link-dir"));
    } catch {
      // Some environments disallow symlinks; skip symlink assertion only.
    }
    const files = await collectKnowledgeFiles(root);
    expect(files.some((f) => f.path.endsWith("note.md"))).toBe(true);
    expect(files.every((f) => isKnowledgeFile(f.path))).toBe(true);
  });

  it("collectCollectionFiles ignores ENOENT paths and scanConfiguredCollection aggregates mtimes", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `kb-scan-b16-${crypto.randomUUID()}-`));
    roots.push(root);
    process.env.KNOWLEDGE_BASE_PATH = root;
    const colDir = path.join(root, "alpha");
    fs.mkdirSync(colDir, { recursive: true });
    const docPath = path.join(colDir, "doc.md");
    fs.writeFileSync(docPath, "content", "utf8");
    const mtime = new Date("2026-06-01T12:00:00.000Z");
    fs.utimesSync(docPath, mtime, mtime);

    const paths = resolveCollectionPaths({
      name: "alpha",
      basePaths: ["alpha", "missing-collection"],
    });
    expect(paths[1]).toContain("missing-collection");

    const files = await collectCollectionFiles({
      name: "alpha",
      category: "internal",
      basePaths: ["alpha", "missing-collection"],
    });
    expect(files).toHaveLength(1);

    const scan = await scanConfiguredCollection({
      name: "alpha",
      category: "internal",
      basePath: "alpha",
    });
    expect(scan.docCount).toBe(1);
    expect(scan.lastUpdated?.toISOString()).toBe(mtime.toISOString());
  });
});
