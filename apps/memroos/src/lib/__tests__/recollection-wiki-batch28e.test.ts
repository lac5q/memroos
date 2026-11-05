// @vitest-environment node
import { randomUUID } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

import { scoreRecollectionCandidate } from "@/lib/recollection-policy";
import { listWikiTree, readWikiPage, resolveWikilink, searchWikiPages } from "@/lib/wiki-vault";

describe("recollection-policy batch28e — lexical, recency, medium risk", () => {
  it("lexicalRelevance returns 0 for empty task tokens (line 287)", () => {
    const scored = scoreRecollectionCandidate(
      {
        id: "lex-b28e",
        tier: "vector",
        content: "batch28e timeline deployment",
        beliefStage: "gold_operational_truth",
        provenance: "vault",
        authorization: "allowed",
      },
      { taskText: "   \t\n", now: new Date("2026-07-17T12:00:00.000Z") },
    );
    expect(scored.components.relevance).toBe(0);
  });

  it("recencyScore hits week, month, and year bands (lines 300-302)", () => {
    const now = new Date("2026-07-17T12:00:00.000Z");
    const week = scoreRecollectionCandidate(
      {
        id: "week-b28e",
        tier: "vector",
        content: "batch28e week recency",
        beliefStage: "gold_operational_truth",
        provenance: "vault",
        authorization: "allowed",
        capturedAt: new Date(now.getTime() - 3 * 24 * 3_600_000).toISOString(),
      },
      { taskText: "batch28e week", now },
    );
    const month = scoreRecollectionCandidate(
      {
        id: "month-b28e",
        tier: "vector",
        content: "batch28e month recency",
        beliefStage: "gold_operational_truth",
        provenance: "vault",
        authorization: "allowed",
        capturedAt: new Date(now.getTime() - 10 * 24 * 3_600_000).toISOString(),
      },
      { taskText: "batch28e month", now },
    );
    const year = scoreRecollectionCandidate(
      {
        id: "year-b28e",
        tier: "vector",
        content: "batch28e year recency",
        beliefStage: "gold_operational_truth",
        provenance: "vault",
        authorization: "allowed",
        capturedAt: new Date(now.getTime() - 200 * 24 * 3_600_000).toISOString(),
      },
      { taskText: "batch28e year", now },
    );
    expect(week.components.recency).toBe(0.75);
    expect(month.components.recency).toBe(0.6);
    expect(year.components.recency).toBe(0.35);
  });

  it("riskPenalty uses medium band (line 336)", () => {
    const scored = scoreRecollectionCandidate(
      {
        id: "med-risk-b28e",
        tier: "vector",
        content: "batch28e medium risk overlap",
        beliefStage: "gold_operational_truth",
        provenance: "vault",
        authorization: "allowed",
        policyRisk: "medium",
      },
      { taskText: "batch28e medium risk", now: new Date("2026-07-17T12:00:00.000Z") },
    );
    expect(scored.components.riskPenalty).toBe(0.5);
  });
});

describe("wiki-vault batch28e — tree depth, dirs, unreadable dirs, dot entries", () => {
  const vaults: string[] = [];

  afterEach(() => {
    for (const vault of vaults) {
      fs.rmSync(vault, { recursive: true, force: true });
    }
    vaults.length = 0;
  });

  it("listWikiTree stops at maxDepth (line 74)", () => {
    const wikiRoot = fs.mkdtempSync(path.join(os.tmpdir(), `wiki-depth-b28e-${randomUUID()}-`));
    vaults.push(wikiRoot);
    let dir = wikiRoot;
    for (let depth = 0; depth < 6; depth += 1) {
      dir = path.join(dir, `d${depth}`);
      fs.mkdirSync(dir);
    }
    fs.writeFileSync(path.join(dir, "leaf.md"), "# deep\n", "utf8");
    const tree = listWikiTree(wikiRoot, 1);
    expect(tree.length).toBeGreaterThan(0);
    expect(JSON.stringify(tree)).not.toContain("leaf.md");
  });

  it("readWikiPage returns null for directories (line 108)", () => {
    const wikiRoot = fs.mkdtempSync(path.join(os.tmpdir(), `wiki-dir-b28e-${randomUUID()}-`));
    vaults.push(wikiRoot);
    fs.mkdirSync(path.join(wikiRoot, "folder-b28e"));
    expect(readWikiPage(wikiRoot, "folder-b28e")).toBeNull();
  });

  it("resolveWikilink skips dotfiles and survives unreadable directories (lines 160, 163)", () => {
    const wikiRoot = fs.mkdtempSync(path.join(os.tmpdir(), `wiki-link-b28e-${randomUUID()}-`));
    vaults.push(wikiRoot);
    fs.writeFileSync(path.join(wikiRoot, ".hidden.md"), "# hidden\n", "utf8");
    fs.writeFileSync(path.join(wikiRoot, "Target-B28E.md"), "# Target\n", "utf8");
    const locked = path.join(wikiRoot, "locked");
    fs.mkdirSync(locked);
    fs.chmodSync(locked, 0o000);
    expect(resolveWikilink(wikiRoot, "Target-B28E")).toMatch(/Target-B28E\.md/i);
    fs.chmodSync(locked, 0o755);
  });

  it("searchWikiPages skips dot-prefixed entries (line 198)", () => {
    const wikiRoot = fs.mkdtempSync(path.join(os.tmpdir(), `wiki-search-b28e-${randomUUID()}-`));
    vaults.push(wikiRoot);
    fs.writeFileSync(path.join(wikiRoot, ".secret-b28e.md"), "batch28e secret token", "utf8");
    fs.writeFileSync(path.join(wikiRoot, "visible-b28e.md"), "batch28e visible token", "utf8");
    const hits = searchWikiPages(wikiRoot, "batch28e");
    expect(hits.some((h) => h.path.includes("visible-b28e"))).toBe(true);
    expect(hits.some((h) => h.path.includes(".secret"))).toBe(false);
  });
});
