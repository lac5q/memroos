// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

import { runWikiDigest } from "@/lib/wiki-digest";

describe("wiki-digest batch19b — dryRun skips watermark writes", () => {
  const vaults: string[] = [];

  afterEach(() => {
    for (const vault of vaults) {
      fs.rmSync(vault, { recursive: true, force: true });
    }
    vaults.length = 0;
  });

  it("does not create watermark file when dryRun is true", async () => {
    const kb = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-b19b-"));
    vaults.push(kb);
    fs.mkdirSync(path.join(kb, "llm-wiki", "wiki"), { recursive: true });
    const summary = await runWikiDigest({
      knowledgeBasePath: kb,
      dryRun: true,
      fetchMemories: async () => [
        {
          id: "m-dry",
          content: "Dry run memory should not persist watermark files.",
          createdAt: "2026-07-19T12:00:00.000Z",
        },
      ],
      now: new Date("2026-07-19T13:00:00.000Z"),
      log: () => undefined,
    });
    expect(summary.written).toBe(1);
    const watermark = path.join(kb, "llm-wiki", ".memroos", "wiki-digest-watermark.json");
    expect(fs.existsSync(watermark)).toBe(false);
  });
});
