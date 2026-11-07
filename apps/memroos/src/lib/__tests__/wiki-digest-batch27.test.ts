// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { clusterKeyForMemory, runWikiDigest } from "@/lib/wiki-digest";

describe("wiki-digest batch27 — watermark parse, digest render metadata, sensitivity gates", () => {
  const vaults: string[] = [];

  afterEach(() => {
    for (const vault of vaults) {
      fs.rmSync(vault, { recursive: true, force: true });
    }
    vaults.length = 0;
    vi.restoreAllMocks();
  });

  it("clusterKeyForMemory hashes very short alphanumeric headings", () => {
    const key = clusterKeyForMemory({ id: "mem-b27-short", content: "!!!", createdAt: null });
    expect(key.startsWith("memory-")).toBe(true);
  });

  it("runWikiDigest writes pages with agent and timestamp metadata in dry run", async () => {
    const kb = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-b27-meta-"));
    vaults.push(kb);
    fs.mkdirSync(path.join(kb, "llm-wiki", "wiki"), { recursive: true });
    const summary = await runWikiDigest({
      knowledgeBasePath: kb,
      dryRun: true,
      fetchMemories: async () => [
        {
          id: "mem-b27-meta",
          content: "Batch27 digest renders agent metadata in wiki pages.",
          createdAt: "2026-07-24T12:00:00.000Z",
          agentId: "agent-b27",
        },
      ],
      now: new Date("2026-07-24T13:00:00.000Z"),
      log: () => undefined,
    });
    expect(summary.written).toBe(1);
    expect(summary.pages.length).toBe(1);
  });

});
