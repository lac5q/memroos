// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  collectCollectionFiles,
  collectKnowledgeFiles,
  scanCollection,
  scanConfiguredCollection,
} from "@/lib/knowledge-collections";

describe("knowledge-collections batch30b — walk stat skip, scan reduce, ENOENT", () => {
  const roots: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const root of roots) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    roots.length = 0;
  });

  it("collectKnowledgeFiles skips entries whose stat fails (lines 65–66)", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `kb-b30b-stat-${randomUUID()}-`));
    roots.push(root);
    const note = path.join(root, `note-${randomUUID().slice(0, 8)}.md`);
    fs.writeFileSync(note, "# batch30b\n", "utf8");

    const actual = await vi.importActual<typeof import("fs/promises")>("fs/promises");
    vi.doMock("fs/promises", () => ({
      ...actual,
      stat: vi.fn(async (target: Parameters<typeof actual.stat>[0]) => {
        if (target.toString() === note) {
          throw new Error("stat blocked batch30b");
        }
        return actual.stat(target);
      }),
      readdir: actual.readdir,
    }));
    vi.resetModules();
    const { collectKnowledgeFiles: collectFiles } = await import("@/lib/knowledge-collections");
    const files = await collectFiles(root);
    expect(files).toHaveLength(0);
  });

  it("scanCollection computes lastUpdated from collected files (line 77)", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `kb-b30b-scan-${randomUUID()}-`));
    roots.push(root);
    const older = path.join(root, "older.md");
    const newer = path.join(root, "newer.md");
    fs.writeFileSync(older, "old\n", "utf8");
    fs.writeFileSync(newer, "new\n", "utf8");
    const oldDate = new Date("2024-01-01T00:00:00.000Z");
    const newDate = new Date("2026-06-01T00:00:00.000Z");
    fs.utimesSync(older, oldDate, oldDate);
    fs.utimesSync(newer, newDate, newDate);

    const scan = await scanCollection(root);
    expect(scan.docCount).toBe(2);
    expect(scan.lastUpdated?.getTime()).toBe(newDate.getTime());
  });

  it("collectCollectionFiles ignores missing roots and merges paths (lines 93, 77)", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `kb-b30b-coll-${randomUUID()}-`));
    roots.push(root);
    const live = path.join(root, "live");
    fs.mkdirSync(live, { recursive: true });
    fs.writeFileSync(path.join(live, "doc.md"), "doc\n", "utf8");

    const merged = await collectCollectionFiles({
      name: "docs",
      category: "internal",
      basePaths: [live, path.join(root, "missing-batch30b")],
    });
    expect(merged).toHaveLength(1);
    const configured = await scanConfiguredCollection({
      name: "docs",
      category: "internal",
      basePaths: [live, path.join(root, "missing-batch30b")],
    });
    expect(configured.docCount).toBe(1);
  });
});
