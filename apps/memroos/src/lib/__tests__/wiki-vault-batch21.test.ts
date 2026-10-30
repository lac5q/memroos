// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

import { listWikiTree, resolveWikilink, searchWikiPages } from "@/lib/wiki-vault";

describe("wiki-vault batch21 — unreadable directories", () => {
  let wikiRoot: string;

  afterEach(() => {
    if (wikiRoot) fs.rmSync(wikiRoot, { recursive: true, force: true });
  });

  it("listWikiTree skips directories that cannot be read", () => {
    wikiRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-vault-b21-"));
    const blocked = path.join(wikiRoot, "blocked");
    fs.mkdirSync(blocked, { recursive: true });
    fs.writeFileSync(path.join(blocked, "secret.md"), "# Secret", "utf8");
    fs.chmodSync(blocked, 0o000);
    try {
      const tree = listWikiTree(wikiRoot, 2);
      expect(tree.every((node) => node.path !== "blocked/secret.md")).toBe(true);
    } finally {
      fs.chmodSync(blocked, 0o755);
    }
  });

  it("resolveWikilink and searchWikiPages ignore unreadable subdirectories", () => {
    wikiRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-vault-b21-search-"));
    fs.writeFileSync(path.join(wikiRoot, "visible.md"), "# Visible\nfindme-b21-token", "utf8");
    const blocked = path.join(wikiRoot, "blocked-search");
    fs.mkdirSync(blocked, { recursive: true });
    fs.writeFileSync(path.join(blocked, "hidden.md"), "# Hidden\nfindme-b21-token", "utf8");
    fs.chmodSync(blocked, 0o000);
    try {
      expect(resolveWikilink(wikiRoot, "visible")).toBe("visible.md");
      const hits = searchWikiPages(wikiRoot, "findme-b21-token", 10);
      expect(hits.some((h) => h.path === "visible.md")).toBe(true);
      expect(hits.some((h) => h.path.includes("blocked-search"))).toBe(false);
    } finally {
      fs.chmodSync(blocked, 0o755);
    }
  });
});
