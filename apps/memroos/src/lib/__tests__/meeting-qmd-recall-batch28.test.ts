// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

import {
  aggregateSourceStatus,
  isSearchAggregateRecalled,
  loadEnabledMeetingCollections,
  searchMeetingCollections,
} from "@/lib/meeting-qmd-recall";
import { SOURCE_STATUS } from "@/lib/meeting-source-status";

describe("meeting-qmd-recall batch28 — empty query, aggregate weakest, config load, recall terminal", () => {
  const temps: string[] = [];

  afterEach(() => {
    for (const dir of temps) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    temps.length = 0;
    delete process.env.MEMROOS_MEETING_SOURCES_CONFIG;
  });

  it("searchMeetingCollections rejects blank queries", async () => {
    const result = await searchMeetingCollections("   ", 5, ["col-a"], async () => ({
      stdout: "[]",
      stderr: "",
    }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/query is required/);
    expect(result.aggregateStatus).toBe(SOURCE_STATUS.providerAbsent);
  });

  it("aggregateSourceStatus picks the weakest status when collections differ", () => {
    const aggregate = aggregateSourceStatus({
      a: { collection: "a", status: SOURCE_STATUS.recalled, count: 1, lastIndexAt: null },
      b: { collection: "b", status: SOURCE_STATUS.providerAbsent, count: 0, lastIndexAt: null },
    });
    expect(aggregate).toBe(SOURCE_STATUS.providerAbsent);
  });

  it("loadEnabledMeetingCollections reads enabled qmdCollections from config file", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meet-src-b28-"));
    temps.push(dir);
    const configPath = path.join(dir, "meeting-sources.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        sources: [
          { enabled: false, qmdCollections: ["disabled-col"] },
          { enabled: true, qmdCollections: ["enabled-batch28", "enabled-batch28"] },
        ],
      }),
      "utf8",
    );
    process.env.MEMROOS_MEETING_SOURCES_CONFIG = configPath;
    const cols = await loadEnabledMeetingCollections(configPath);
    expect(cols).toEqual(["enabled-batch28"]);
  });

  it("isSearchAggregateRecalled is true only for terminal aggregate statuses", () => {
    expect(isSearchAggregateRecalled({ aggregateStatus: SOURCE_STATUS.recalled })).toBe(true);
    expect(isSearchAggregateRecalled({ aggregateStatus: SOURCE_STATUS.indexedUnrecalled })).toBe(false);
  });

  it("searchMeetingCollections surfaces exec errors on empty hit sets", async () => {
    const execMock = async () => {
      throw new Error("qmd binary missing batch28");
    };
    const result = await searchMeetingCollections("batch28-query", 4, ["only-col"], execMock);
    expect(result.hits).toHaveLength(0);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/qmd binary missing/);
    expect(result.collectionStatus["only-col"]?.reason).toMatch(/qmd binary missing/);
  });
});
