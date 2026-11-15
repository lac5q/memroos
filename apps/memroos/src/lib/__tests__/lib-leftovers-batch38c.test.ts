// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

import { normalizeRegistryEntry, parseSkillMd } from "@/lib/skills/registry";
import { loadBaselineSkillContent } from "@/lib/skillforge/behavioral-sandbox-scorer";
import { resolveWikilink } from "@/lib/wiki-vault";

describe("lib leftovers batch38c", () => {
  const wikiRoots: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const root of wikiRoots) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    wikiRoots.length = 0;
  });

  it("resolveWikilink continues past unreadable directories (wiki-vault 160)", () => {
    const wikiRoot = path.join(os.tmpdir(), `wiki-b38c-${randomUUID()}-`);
    wikiRoots.push(wikiRoot);
    const pages = path.join(wikiRoot, "pages");
    fs.mkdirSync(pages, { recursive: true });
    const slug = `B38cPage-${randomUUID().slice(0, 6)}`;
    fs.writeFileSync(path.join(pages, `${slug}.md`), "# page\n", "utf8");

    const trap = path.join(wikiRoot, "trap");
    fs.mkdirSync(trap);
    const realReaddir = fs.readdirSync.bind(fs);
    vi.spyOn(fs, "readdirSync").mockImplementation((dir, opts) => {
      const dirStr = String(dir);
      if (dirStr === trap) {
        throw new Error("eacces");
      }
      return realReaddir(dir, opts as Parameters<typeof fs.readdirSync>[1]);
    });

    expect(resolveWikilink(wikiRoot, `pages/${slug}`)).toBe(`pages/${slug}.md`);
  });

  it("tableHasColumn PRAGMA catch returns false (behavioral-sandbox-scorer 70)", () => {
    const db = new Database(":memory:");
    const originalPrepare = db.prepare.bind(db);
    vi.spyOn(db, "prepare").mockImplementation((sql: string) => {
      if (sql.includes("PRAGMA table_info")) {
        throw new Error("pragma blocked b38c");
      }
      return originalPrepare(sql);
    });
    const body = loadBaselineSkillContent(db, `skill-b38c-${randomUUID().slice(0, 8)}`, "1.0.0");
    expect(body).toContain("skill-b38c");
    db.close();
  });

  it.skip("serializeYamlValue numeric scalar (okf 208) — buildOkfBundle requires string timestamp for log.md", () => {});

  it("normalizeRegistryEntry honors review on complete skills (registry 380)", () => {
    const name = `review-b38c-${randomUUID().slice(0, 8)}`;
    const md = `---
name: ${name}
description: batch38c review path
owner: ops
source_harness: claude
risk_tier: low
dispatch_status: review
version: 1.0.0
---

## Preconditions
none

## Allowed Tools
read_file

## Verification Checks
verify

## Rollback
revert

## Evidence Examples
verify
`;
    const entry = normalizeRegistryEntry(parseSkillMd(md), "claude", "importer-b38c");
    expect(entry.dispatch_status).toBe("review");
    expect(entry.completeness_pct).toBe(100);
  });

  it("processNativeMemoryIngest rejects non-warn-only diffs (native-memory/sink 74)", async () => {
    vi.resetModules();
    const budget = await import("@/lib/directive-budget");
    vi.spyOn(budget, "directiveDiff").mockReturnValue({
      added: [],
      removed: [],
      changed: [],
      identical: false,
      warnOnly: false as unknown as true,
    });
    const { processNativeMemoryIngest: ingest } = await import("@/lib/native-memory/sink");
    expect(() =>
      ingest({
        source: "codex",
        agentId: "agent-b38c",
        userId: "user-b38c",
        content: "local\n",
        memoryPath: "MEMORY.md",
        canonicalContent: "canonical\n",
      }),
    ).toThrow(/warn-only/i);
  });

  it.skip("PROVIDERS_BY_KEY duplicate key throw (providers 277) — module init guard; no runtime hook without production edit", () => {});
});