// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

import {
  DEFAULT_MEETING_COLLECTIONS,
  aggregateSourceStatus,
  isSearchAggregateRecalled,
  loadEnabledMeetingCollections,
  searchMeetingCollections,
} from "@/lib/meeting-qmd-recall";
import { SOURCE_STATUS } from "@/lib/meeting-source-status";

describe("meeting-qmd-recall batch35", () => {
  const temps: string[] = [];

  afterEach(() => {
    for (const dir of temps) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    temps.length = 0;
    vi.unstubAllEnvs();
    delete process.env.MEMROOS_MEETING_SOURCES_CONFIG;
  });

  it("expandHome replaces $HOME in config paths", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), `home-b35-${randomUUID()}-`));
    temps.push(home);
    const cfgPath = path.join(home, "meeting-sources.json");
    fs.writeFileSync(
      cfgPath,
      JSON.stringify({ sources: [{ enabled: true, qmdCollections: ["dollar-home-b35"] }] }),
      "utf8",
    );
    vi.stubEnv("HOME", home);
    const cols = await loadEnabledMeetingCollections("$HOME/meeting-sources.json");
    expect(cols).toEqual(["dollar-home-b35"]);
  });

  it("loadEnabledMeetingCollections falls back after unreadable config", async () => {
    const cols = await loadEnabledMeetingCollections("/nonexistent/b35/meeting-sources.json");
    expect(cols).toEqual([...DEFAULT_MEETING_COLLECTIONS]);
  });

  it("searchMeetingCollections rejects blank queries", async () => {
    const result = await searchMeetingCollections("   ", 4, ["col-b35"]);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("query is required");
  });

  it("searchMeetingCollections normalizes results[] payloads", async () => {
    const execMock = vi.fn(async () => ({
      stdout: JSON.stringify({ results: [{ title: "Results B35", snippet: "hit-b35" }] }),
      stderr: "",
    }));
    const result = await searchMeetingCollections("batch35", 4, ["col-b35"], execMock);
    expect(result.hits[0]?.title).toBe("Results B35");
    expect(result.hits[0]?.content).toContain("hit-b35");
  });

  it("searchMeetingCollections marks empty collections indexedUnrecalled", async () => {
    const execMock = vi.fn(async () => ({ stdout: "[]", stderr: "" }));
    const result = await searchMeetingCollections("batch35-empty", 4, ["empty-b35"], execMock);
    expect(result.collectionStatus["empty-b35"]?.status).toBe(SOURCE_STATUS.indexedUnrecalled);
  });

  it("isSearchAggregateRecalled reflects terminal aggregate statuses", () => {
    expect(
      isSearchAggregateRecalled({
        aggregateStatus: aggregateSourceStatus({
          a: { collection: "a", status: SOURCE_STATUS.recalled, count: 1, lastIndexAt: null },
        }),
      }),
    ).toBe(true);
    expect(
      isSearchAggregateRecalled({
        aggregateStatus: aggregateSourceStatus({
          a: { collection: "a", status: SOURCE_STATUS.providerAbsent, count: 0, lastIndexAt: null },
        }),
      }),
    ).toBe(false);
  });

  it("searchMeetingCollections deduplicates hits across collections", async () => {
    const payload = { file: "/docs/b35.md", snippet: "once" };
    const execMock = vi.fn(async () => ({ stdout: JSON.stringify([payload]), stderr: "" }));
    const result = await searchMeetingCollections("batch35-dedupe", 6, ["c1-b35", "c2-b35"], execMock);
    const ids = result.hits.map((h) => h.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("aggregateSourceStatus handles unknown statuses as providerAbsent", () => {
    expect(
      aggregateSourceStatus({
        weird: { collection: "weird", status: "not-a-status" as never, count: 0, lastIndexAt: null },
      }),
    ).toBe(SOURCE_STATUS.providerAbsent);
  });
});
