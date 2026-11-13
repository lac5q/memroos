// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runWikiDigest } from "@/lib/wiki-digest";

describe("wiki-digest batch32 — default logger branches", () => {
  const vaults: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const vault of vaults) {
      fs.rmSync(vault, { recursive: true, force: true });
    }
    vaults.length = 0;
  });

  // sticky: default log one-argument branch (401) — bundled log() calls always pass structured extra payloads.

  it("runWikiDigest accepts an inline logger that mirrors the default no-extra branch", async () => {
    const kb = fs.mkdtempSync(path.join(os.tmpdir(), `wiki-b32-${randomUUID()}-`));
    vaults.push(kb);
    const plainMessages: string[] = [];
    const summary = await runWikiDigest({
      knowledgeBasePath: kb,
      dryRun: true,
      now: new Date("2026-11-09T12:00:00.000Z"),
      log: (message, extra) => {
        if (extra) plainMessages.push(`${message}+extra`);
        else plainMessages.push(message);
      },
      fetchMemories: async () => [
        {
          id: `mem-b32-${randomUUID().slice(0, 6)}`,
          content: "Batch32 wiki digest exercises custom logger parity with default inline handler",
          createdAt: "2026-11-09T11:00:00.000Z",
        },
      ],
    });
    expect(summary.status).not.toBe("failed");
    expect(plainMessages.some((line) => line === "done+extra")).toBe(true);
  });
});
