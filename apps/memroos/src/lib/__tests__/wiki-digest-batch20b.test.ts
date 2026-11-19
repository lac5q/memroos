// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

import { runWikiDigest } from "@/lib/wiki-digest";

describe("wiki-digest batch20b", () => {
  const vaults: string[] = [];

  afterEach(() => {
    for (const vault of vaults) {
      fs.rmSync(vault, { recursive: true, force: true });
    }
    vaults.length = 0;
  });

  it("skips memories at or before watermark lastId on equal createdAt", async () => {
    const kb = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-b20b-"));
    vaults.push(kb);
    fs.mkdirSync(path.join(kb, "llm-wiki", "wiki"), { recursive: true });
    fs.mkdirSync(path.join(kb, "llm-wiki", ".memroos"), { recursive: true });
    fs.writeFileSync(
      path.join(kb, "llm-wiki", ".memroos", "wiki-digest-watermark.json"),
      JSON.stringify({
        lastCreatedAt: "2026-07-20T10:00:00.000Z",
        lastId: "m-water",
        updatedAt: "2026-07-20T10:00:00.000Z",
        pagesWritten: 1,
      }),
      "utf8",
    );
    const summary = await runWikiDigest({
      knowledgeBasePath: kb,
      dryRun: true,
      fetchMemories: async () => [
        { id: "m-water", content: "Already digested.", createdAt: "2026-07-20T10:00:00.000Z" },
        { id: "m-zzz-after", content: "New memory after watermark.", createdAt: "2026-07-20T10:00:00.000Z" },
      ],
      now: new Date("2026-07-20T11:00:00.000Z"),
      log: () => undefined,
    });
    expect(summary.written).toBe(1);
    expect(summary.watermarkAfter.lastId).toBe("m-zzz-after");
  });

  it("returns zero written when fetchMemories yields an empty list", async () => {
    const kb = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-b20b-empty-"));
    vaults.push(kb);
    fs.mkdirSync(path.join(kb, "llm-wiki", "wiki"), { recursive: true });
    const summary = await runWikiDigest({
      knowledgeBasePath: kb,
      dryRun: true,
      fetchMemories: async () => [],
      log: () => undefined,
    });
    expect(summary.written).toBe(0);
    expect(summary.skipped).toBe(0);
  });
});
