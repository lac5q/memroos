// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

import {
  aggregateSourceStatus,
  loadEnabledMeetingCollections,
  searchMeetingCollections,
} from "@/lib/meeting-qmd-recall";
import { SOURCE_STATUS } from "@/lib/meeting-source-status";

describe("meeting-qmd-recall batch26 — defaults, nested hits, query guard", () => {
  let tmpDir: string | undefined;

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
    delete process.env.MEMROOS_MEETING_SOURCES_CONFIG;
  });

  it("loadEnabledMeetingCollections falls back to default collections when config is missing", async () => {
    process.env.MEMROOS_MEETING_SOURCES_CONFIG = path.join(os.tmpdir(), `missing-b26-${crypto.randomUUID()}.json`);
    const cols = await loadEnabledMeetingCollections();
    expect(cols.length).toBeGreaterThan(0);
    expect(cols).toContain("meet-recordings-zoom");
  });

  it("searchMeetingCollections rejects empty query", async () => {
    const result = await searchMeetingCollections("   ", 5, ["meet-recordings-b26-empty"]);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/query is required/);
  });

  it("searchMeetingCollections normalizes nested results envelopes and scalar metadata hits", async () => {
    const execMock = async (_file: string, args: string[]) => {
      const collection = args[args.indexOf("-c") + 1];
      if (collection === "meet-recordings-b26-nested") {
        return {
          stdout: JSON.stringify({
            results: [
              {
                file: "/meetings/nested.md",
                excerpt: "nested envelope excerpt",
                score: 7,
                indexed_at: "2026-07-02T00:00:00Z",
              },
            ],
          }),
          stderr: "",
        };
      }
      return {
        stdout: JSON.stringify({ file: "solo-b26.md", name: "Solo", text: "scalar body" }),
        stderr: "",
      };
    };
    const nested = await searchMeetingCollections("policy", 4, ["meet-recordings-b26-nested"], execMock);
    expect(nested.hits[0]?.content).toContain("nested envelope");
    expect(nested.hits[0]?.metadata).toMatchObject({ indexedAt: "2026-07-02T00:00:00Z" });

    const scalar = await searchMeetingCollections("solo", 4, ["meet-recordings-b26-scalar"], execMock);
    expect(scalar.hits[0]?.title).toBe("Solo");
  });

  it("aggregateSourceStatus picks weakest status across mixed collections", () => {
    expect(
      aggregateSourceStatus({
        good: { collection: "good", status: SOURCE_STATUS.recalled, count: 1, lastIndexAt: null },
        bad: { collection: "bad", status: SOURCE_STATUS.providerAbsent, count: 0, lastIndexAt: null },
      }),
    ).toBe(SOURCE_STATUS.providerAbsent);
  });
});
