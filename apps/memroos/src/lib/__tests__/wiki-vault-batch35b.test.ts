// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { resolveWikilink } from "../wiki-vault";

const ROOT = path.join(os.tmpdir(), `wiki-vault-b35b-${randomUUID()}`);

afterEach(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
});

describe("wiki-vault batch35b", () => {
  it("resolveWikilink continues past unreadable dirs and skips dot entries (160, 163)", () => {
    const wikiRoot = path.join(ROOT, "wiki");
    const visibleDir = path.join(wikiRoot, "visible");
    fs.mkdirSync(visibleDir, { recursive: true });
    const title = `Leaf-${randomUUID().slice(0, 6)}`;
    fs.writeFileSync(path.join(visibleDir, `${title}.md`), "# page\n", "utf8");
    fs.writeFileSync(path.join(visibleDir, `.${title}.md`), "# dot\n", "utf8");

    const blocked = path.join(wikiRoot, "blocked");
    fs.mkdirSync(blocked);
    let chmodBlocked = false;
    try {
      fs.chmodSync(blocked, 0);
      chmodBlocked = true;
    } catch {
      chmodBlocked = false;
    }

    const resolved = resolveWikilink(wikiRoot, title);
    expect(resolved).toBe(`visible/${title}.md`);

    if (chmodBlocked) {
      try {
        fs.chmodSync(blocked, 0o755);
      } catch {
        /* best-effort */
      }
    }
  });
});
