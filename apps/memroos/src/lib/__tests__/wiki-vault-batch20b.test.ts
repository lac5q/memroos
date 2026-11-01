// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

import {
  extractWikilinks,
  listWikiTree,
  readWikiPage,
  resolveWikiPath,
  resolveWikilink,
  searchWikiPages,
} from "@/lib/wiki-vault";

describe("wiki-vault batch20b", () => {
  let wikiRoot: string;

  afterEach(() => {
    if (wikiRoot) fs.rmSync(wikiRoot, { recursive: true, force: true });
  });

  function makeVault() {
    wikiRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-vault-b20b-"));
    fs.mkdirSync(path.join(wikiRoot, "guides"), { recursive: true });
    fs.writeFileSync(
      path.join(wikiRoot, "guides", "alpha.md"),
      "# Alpha Guide\nSee [[beta]] for more.\nAlpha searchable token batch20b.",
      "utf8",
    );
    fs.writeFileSync(path.join(wikiRoot, "beta.md"), "# Beta\nLinked page.", "utf8");
  }

  it("resolveWikiPath rejects path traversal outside wiki root", () => {
    makeVault();
    expect(resolveWikiPath(wikiRoot, "../outside.md")).toBeNull();
  });

  it("extractWikilinks parses aliases and heading fragments", () => {
    const links = extractWikilinks("Go to [[beta#section|Beta alias]] and [[alpha]].");
    expect(links).toEqual(["beta", "alpha"]);
  });

  it("resolveWikilink finds pages by basename when path is not direct", () => {
    makeVault();
    expect(resolveWikilink(wikiRoot, "beta")).toBe("beta.md");
  });

  it("readWikiPage and searchWikiPages return title and snippet hits", () => {
    makeVault();
    const page = readWikiPage(wikiRoot, "guides/alpha.md");
    expect(page?.title).toBe("Alpha Guide");
    const hits = searchWikiPages(wikiRoot, "batch20b", 5);
    expect(hits.some((h) => h.path.includes("alpha.md"))).toBe(true);
  });

  it("listWikiTree skips dot directories and includes nested files", () => {
    makeVault();
    fs.mkdirSync(path.join(wikiRoot, ".hidden"), { recursive: true });
    const tree = listWikiTree(wikiRoot, 3);
    expect(tree.some((n) => n.name === "guides" && n.type === "dir")).toBe(true);
    expect(JSON.stringify(tree)).not.toContain(".hidden");
  });
});
