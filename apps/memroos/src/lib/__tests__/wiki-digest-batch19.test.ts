// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runWikiDigest } from "@/lib/wiki-digest";

function makeVault(): string {
  const kb = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-b19-"));
  fs.mkdirSync(path.join(kb, "llm-wiki", "wiki"), { recursive: true });
  return kb;
}

describe("wiki-digest batch19 — watermark tie-break and default logger", () => {
  const vaults: string[] = [];

  afterEach(() => {
    for (const vault of vaults) {
      fs.rmSync(vault, { recursive: true, force: true });
    }
    vaults.length = 0;
    vi.restoreAllMocks();
  });

  it("orders same-timestamp memories by id when watermark matches createdAt", async () => {
    const kb = makeVault();
    vaults.push(kb);
    fs.mkdirSync(path.join(kb, "llm-wiki", ".memroos"), { recursive: true });
    fs.writeFileSync(
      path.join(kb, "llm-wiki", ".memroos", "wiki-digest-watermark.json"),
      JSON.stringify({
        lastCreatedAt: "2026-07-18T12:00:00.000Z",
        lastId: "m-aaa",
        updatedAt: "2026-07-18T12:00:00.000Z",
        pagesWritten: 1,
      }),
      "utf8",
    );
    const summary = await runWikiDigest({
      knowledgeBasePath: kb,
      dryRun: true,
      now: new Date("2026-07-18T13:00:00.000Z"),
      fetchMemories: async () => [
        {
          id: "m-aab",
          content: "Same timestamp but lexicographically after watermark id.",
          createdAt: "2026-07-18T12:00:00.000Z",
        },
        {
          id: "m-aaa",
          content: "Exact watermark id should be skipped.",
          createdAt: "2026-07-18T12:00:00.000Z",
        },
      ],
      log: () => undefined,
    });
    expect(summary.written).toBe(1);
    expect(summary.watermarkAfter.lastId).toBe("m-aab");
  });

  it("default logger accepts structured extra metadata", async () => {
    const kb = makeVault();
    vaults.push(kb);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await runWikiDigest({
      knowledgeBasePath: kb,
      dryRun: true,
      fetchMemories: async () => [
        {
          id: "m-log",
          content: "Logger should emit digest progress for this memory.",
          createdAt: "2026-07-18T15:00:00.000Z",
        },
      ],
      now: new Date("2026-07-18T16:00:00.000Z"),
    });
    expect(logSpy.mock.calls.some((call) => String(call[0]).includes("[wiki-digest]"))).toBe(true);
    logSpy.mockRestore();
  });
});
