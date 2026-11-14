// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runWikiDigest } from "@/lib/wiki-digest";

describe("wiki-digest batch29 — default logger no-extra branch", () => {
  const vaults: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const vault of vaults) {
      fs.rmSync(vault, { recursive: true, force: true });
    }
    vaults.length = 0;
  });

  it("default log callback hits console.log without extra object (line 401)", async () => {
    const kb = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-b29-log-"));
    vaults.push(kb);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const summary = await runWikiDigest({
      knowledgeBasePath: kb,
      dryRun: true,
      now: new Date("2026-11-06T12:00:00.000Z"),
      fetchMemories: async () => [
        {
          id: "mem-b29-log",
          content: "batch29 operational wiki digest line for default logger branch",
          createdAt: "2026-11-07T00:00:00.000Z",
        },
      ],
    });

    expect(summary.written).toBeGreaterThan(0);
    expect(logSpy.mock.calls.some((call) => call[0] === "[wiki-digest] done")).toBe(true);
  });
});
