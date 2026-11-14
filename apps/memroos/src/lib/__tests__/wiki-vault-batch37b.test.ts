// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import { resolveWikilink } from "@/lib/wiki-vault";

describe("wiki-vault batch37b — readdir failure continue (160)", () => {
  const wikiRoot = fs.mkdtempSync(path.join(os.tmpdir(), `wiki-b37b-${randomUUID()}-`));

  afterEach(() => {
    fs.rmSync(wikiRoot, { recursive: true, force: true });
  });

  it("resolveWikilink skips unreadable directories during basename search", () => {
    const readable = path.join(wikiRoot, "notes");
    const locked = path.join(wikiRoot, "locked");
    fs.mkdirSync(readable, { recursive: true });
    fs.mkdirSync(locked, { recursive: true });
    fs.chmodSync(locked, 0o000);
    fs.writeFileSync(path.join(readable, "Target Batch37b.md"), "# ok", "utf8");
    try {
      const resolved = resolveWikilink(wikiRoot, "Target Batch37b");
      expect(resolved).toBe("notes/Target Batch37b.md");
    } finally {
      fs.chmodSync(locked, 0o755);
    }
  });
});