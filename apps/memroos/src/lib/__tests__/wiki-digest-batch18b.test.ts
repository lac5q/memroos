// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

import { runWikiDigest } from "@/lib/wiki-digest";

function makeVault(): string {
  const kb = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-b18b-"));
  fs.mkdirSync(path.join(kb, "llm-wiki", "wiki"), { recursive: true });
  return kb;
}

describe("wiki-digest batch18b", () => {
  const vaults: string[] = [];

  afterEach(() => {
    for (const vault of vaults) {
      fs.rmSync(vault, { recursive: true, force: true });
    }
    vaults.length = 0;
  });

  it("skips memories containing secret-like patterns", async () => {
    const kb = makeVault();
    vaults.push(kb);
    const summary = await runWikiDigest({
      knowledgeBasePath: kb,
      dryRun: true,
      now: new Date("2026-07-18T15:00:00.000Z"),
      fetchMemories: async () => [
        {
          id: "m-secret",
          content: "Rotate api_key=super-secret-value before deploy.",
          createdAt: "2026-07-18T14:00:00.000Z",
        },
        {
          id: "m-safe",
          content: "Ship the wiki digest batch18b coverage tests.",
          createdAt: "2026-07-18T14:30:00.000Z",
        },
      ],
      log: () => undefined,
    });
    expect(summary.skipped).toBeGreaterThanOrEqual(1);
    expect(summary.written).toBe(1);
  });

  it("returns skipped status when no new memories cluster", async () => {
    const kb = makeVault();
    vaults.push(kb);
    const summary = await runWikiDigest({
      knowledgeBasePath: kb,
      dryRun: true,
      fetchMemories: async () => [],
      log: () => undefined,
    });
    expect(summary.status).toBe("skipped");
    expect(summary.reason).toMatch(/nothing_new/);
  });
});
