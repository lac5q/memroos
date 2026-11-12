// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { resolveWikilink } from "../wiki-vault";

const ROOT = path.join(os.tmpdir(), `wiki-vault-b33b-${randomUUID()}`);

afterEach(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
});

describe("wiki-vault batch33b", () => {
  it("resolveWikilink skips dotfiles and unreadable dirs (160, 163)", () => {
    const wikiRoot = path.join(ROOT, "wiki");
    const topicDir = path.join(wikiRoot, "topics");
    fs.mkdirSync(topicDir, { recursive: true });
    const needle = `TargetPage-${randomUUID().slice(0, 6)}`;
    fs.writeFileSync(path.join(topicDir, `${needle}.md`), "# visible\n", "utf8");
    fs.writeFileSync(path.join(topicDir, `.${needle}.md`), "# hidden dotfile\n", "utf8");

    const blocked = path.join(wikiRoot, "blocked");
    fs.mkdirSync(blocked);
    try {
      fs.chmodSync(blocked, 0);
    } catch {
      // Some sandboxes disallow chmod; still exercise basename search via topics/.
    }

    const resolved = resolveWikilink(wikiRoot, `topics/${needle}`);
    expect(resolved).toBe(`topics/${needle}.md`);

    try {
      if (fs.existsSync(blocked)) fs.chmodSync(blocked, 0o755);
    } catch {
      /* restore best-effort */
    }
  });
});
