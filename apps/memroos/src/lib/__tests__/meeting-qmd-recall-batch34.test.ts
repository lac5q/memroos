// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  aggregateSourceStatus,
  loadEnabledMeetingCollections,
  searchMeetingCollections,
} from "@/lib/meeting-qmd-recall";
import { SOURCE_STATUS } from "@/lib/meeting-source-status";

describe("meeting-qmd-recall batch34 — normalizeHits and config fallbacks", () => {
  const temps: string[] = [];

  afterEach(() => {
    for (const dir of temps) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    temps.length = 0;
    vi.unstubAllEnvs();
    delete process.env.MEMROOS_MEETING_SOURCES_CONFIG;
  });

  it("expandHome handles bare ~ config paths (59)", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "home-b34-"));
    temps.push(home);
    const cfgPath = path.join(home, "meeting-sources.json");
    fs.writeFileSync(
      cfgPath,
      JSON.stringify({ sources: [{ enabled: true, qmdCollections: ["tilde-b34"] }] }),
      "utf8",
    );
    vi.stubEnv("HOME", home);
    const cols = await loadEnabledMeetingCollections("~/meeting-sources.json");
    expect(cols).toEqual(["tilde-b34"]);
  });

  it("loadEnabledMeetingCollections skips disabled sources (80)", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meet-b34-"));
    temps.push(dir);
    const cfgPath = path.join(dir, "meeting-sources.json");
    fs.writeFileSync(
      cfgPath,
      JSON.stringify({
        sources: [
          { enabled: false, qmdCollections: ["off-b34"] },
          { enabled: true, qmdCollections: ["on-b34"] },
        ],
      }),
      "utf8",
    );
    const cols = await loadEnabledMeetingCollections(cfgPath);
    expect(cols).toEqual(["on-b34"]);
  });

  it("searchMeetingCollections normalizes single-object payload with file field (99)", async () => {
    const payload = { file: "/docs/b34.md", title: "Batch34", snippet: "snippet b34", score: 0.8 };
    const execMock = vi.fn(async () => ({ stdout: JSON.stringify(payload), stderr: "" }));
    const result = await searchMeetingCollections("batch34-query", 4, ["col-b34"], execMock);
    expect(result.hits[0]?.title).toBe("Batch34");
    expect(result.hits[0]?.content).toContain("snippet b34");
  });

  it("searchMeetingCollections maps non-object hits to strings (103–109)", async () => {
    const execMock = vi.fn(async () => ({ stdout: JSON.stringify([null, "plain-hit-b34"]), stderr: "" }));
    const result = await searchMeetingCollections("batch34", 4, ["col-b34"], execMock);
    expect(result.hits.some((h) => h.content.includes("plain-hit-b34"))).toBe(true);
  });

  it("aggregateSourceStatus returns providerAbsent for empty map (155)", () => {
    expect(aggregateSourceStatus({})).toBe(SOURCE_STATUS.providerAbsent);
  });

  it("aggregateSourceStatus prefers weakest status across collections (157–162)", () => {
    expect(
      aggregateSourceStatus({
        good: { collection: "good", status: SOURCE_STATUS.recalled, count: 1, lastIndexAt: null },
        bad: { collection: "bad", status: SOURCE_STATUS.providerAbsent, count: 0, lastIndexAt: null },
      }),
    ).toBe(SOURCE_STATUS.providerAbsent);
  });
});
