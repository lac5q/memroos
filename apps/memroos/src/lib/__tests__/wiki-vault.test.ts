// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  extractWikilinks,
  getWikiRoot,
  listWikiTree,
  readWikiPage,
  resolveWikiPath,
  resolveWikilink,
  searchWikiPages,
  wikiRootExists,
} from "@/lib/wiki-vault";

describe("wiki-vault helpers", () => {
  let wikiRoot: string;

  beforeEach(() => {
    wikiRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-vault-"));
    fs.mkdirSync(path.join(wikiRoot, "guides"), { recursive: true });
    fs.writeFileSync(
      path.join(wikiRoot, "guides", "intro.md"),
      "# Intro Guide\nSee [[other-note|alias]] and [[missing-target]].\nkeyword needle here",
      "utf8"
    );
    fs.writeFileSync(path.join(wikiRoot, "other-note.md"), "# Other\nbody", "utf8");
  });

  afterEach(() => {
    fs.rmSync(wikiRoot, { recursive: true, force: true });
  });

  it("resolves wiki root override and blocks traversal", () => {
    expect(getWikiRoot({ wikiRoot })).toBe(path.resolve(wikiRoot));
    expect(resolveWikiPath(wikiRoot, "../etc/passwd")).toBeNull();
    expect(wikiRootExists(wikiRoot)).toBe(true);
    expect(wikiRootExists(path.join(wikiRoot, "missing"))).toBe(false);
  });

  it("lists tree, reads pages, and resolves wikilinks", () => {
    const tree = listWikiTree(wikiRoot);
    expect(tree.some((n) => n.name === "guides" && n.type === "dir")).toBe(true);
    const page = readWikiPage(wikiRoot, "guides/intro.md");
    expect(page?.title).toBe("Intro Guide");
    expect(extractWikilinks(page!.content)).toEqual(expect.arrayContaining(["other-note", "missing-target"]));
    expect(resolveWikilink(wikiRoot, "other-note")).toBe("other-note.md");
    expect(resolveWikilink(wikiRoot, "missing-target")).toBeNull();
  });

  it("resolves wiki root from trimmed override path", () => {
    expect(getWikiRoot({ wikiRoot: `  ${wikiRoot}  ` })).toBe(path.resolve(wikiRoot));
  });

  it("searches page content with snippets", () => {
    const hits = searchWikiPages(wikiRoot, "needle", 5);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.path).toBe("guides/intro.md");
    expect(hits[0]?.snippet.toLowerCase()).toContain("needle");
    expect(searchWikiPages(wikiRoot, "   ")).toEqual([]);
  });
});
