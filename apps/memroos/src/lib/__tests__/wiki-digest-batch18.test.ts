// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

import { readWikiDigestWatermark, runWikiDigest, writeWikiDigestWatermark } from "@/lib/wiki-digest";

function makeVault(): string {
  const kb = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-b18-"));
  fs.mkdirSync(path.join(kb, "llm-wiki", "wiki"), { recursive: true });
  return kb;
}

describe("wiki-digest batch18 — watermark ordering and dry-run updates", () => {
  const vaults: string[] = [];

  afterEach(() => {
    for (const vault of vaults) {
      fs.rmSync(vault, { recursive: true, force: true });
    }
    vaults.length = 0;
  });

  it("skips memories at or before the persisted watermark", async () => {
    const kb = makeVault();
    vaults.push(kb);
    writeWikiDigestWatermark(kb, {
      lastCreatedAt: "2026-07-18T12:00:00.000Z",
      lastId: "m-old",
      updatedAt: "2026-07-18T12:00:00.000Z",
      pagesWritten: 1,
    });
    const summary = await runWikiDigest({
      knowledgeBasePath: kb,
      dryRun: true,
      now: new Date("2026-07-18T13:00:00.000Z"),
      fetchMemories: async () => [
        {
          id: "m-old",
          content: "Already digested memory should be skipped.",
          createdAt: "2026-07-18T11:00:00.000Z",
        },
        {
          id: "m-new",
          content: "Fresh memory after watermark should be written.",
          createdAt: "2026-07-18T12:30:00.000Z",
        },
      ],
      log: () => undefined,
    });
    expect(summary.skipped).toBeGreaterThanOrEqual(1);
    expect(summary.written).toBe(1);
    expect(readWikiDigestWatermark(kb).lastId).toBe("m-old");
  });

  it("updates watermarkAfter in dry-run when newest memory advances the cursor", async () => {
    const kb = makeVault();
    vaults.push(kb);
    const summary = await runWikiDigest({
      knowledgeBasePath: kb,
      dryRun: true,
      now: new Date("2026-07-18T14:00:00.000Z"),
      fetchMemories: async () => [
        {
          id: "m-dry-new",
          content: "Dry run still computes the next watermark cursor.",
          createdAt: "2026-07-18T13:30:00.000Z",
        },
      ],
      log: () => undefined,
    });
    expect(summary.watermarkAfter.lastId).toBe("m-dry-new");
    expect(readWikiDigestWatermark(kb).lastId).not.toBe("m-dry-new");
  });
});
