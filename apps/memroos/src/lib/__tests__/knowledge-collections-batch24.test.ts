// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

import { collectCollectionFiles, scanCollection, scanConfiguredCollection } from "@/lib/knowledge-collections";

describe("knowledge-collections batch24 — missing roots and empty scans", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    roots.length = 0;
    delete process.env.KNOWLEDGE_BASE_PATH;
  });

  it("scanCollection returns zero docs for an empty directory", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `kb-empty-b24-${randomUUID()}-`));
    roots.push(root);
    const scan = await scanCollection(root);
    expect(scan.docCount).toBe(0);
    expect(scan.lastUpdated).toBeNull();
  });

  it("collectCollectionFiles skips missing base paths and merges existing ones", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `kb-missing-b24-${randomUUID()}-`));
    roots.push(root);
    process.env.KNOWLEDGE_BASE_PATH = root;
    const present = path.join(root, "present");
    fs.mkdirSync(present, { recursive: true });
    fs.writeFileSync(path.join(present, "doc.md"), "# doc\n", "utf8");
    const files = await collectCollectionFiles({
      name: "mixed",
      category: "internal",
      basePaths: ["missing-dir", "present"],
    });
    expect(files).toHaveLength(1);
    expect(files[0]?.path.endsWith("doc.md")).toBe(true);
  });

  it("scanConfiguredCollection picks the newest mtime across merged roots", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `kb-mtime-b24-${randomUUID()}-`));
    roots.push(root);
    process.env.KNOWLEDGE_BASE_PATH = root;
    const older = path.join(root, "older");
    const newer = path.join(root, "newer");
    fs.mkdirSync(older, { recursive: true });
    fs.mkdirSync(newer, { recursive: true });
    fs.writeFileSync(path.join(older, "old.md"), "# old\n", "utf8");
    fs.writeFileSync(path.join(newer, "new.md"), "# new\n", "utf8");
    const oldTime = new Date("2020-01-01T00:00:00.000Z");
    const newTime = new Date("2026-01-01T00:00:00.000Z");
    fs.utimesSync(path.join(older, "old.md"), oldTime, oldTime);
    fs.utimesSync(path.join(newer, "new.md"), newTime, newTime);
    const scan = await scanConfiguredCollection({
      name: "mtime",
      category: "internal",
      basePaths: ["older", "newer"],
    });
    expect(scan.docCount).toBe(2);
    expect(scan.lastUpdated?.getTime()).toBe(newTime.getTime());
  });
});
