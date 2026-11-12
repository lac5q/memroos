// @vitest-environment node
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  aggregateSourceStatus,
  isSearchAggregateRecalled,
  searchMeetingCollections,
} from "@/lib/meeting-qmd-recall";
import { SOURCE_STATUS } from "@/lib/meeting-source-status";

describe("meeting-qmd-recall batch35b", () => {
  it("searchMeetingCollections surfaces exec stderr failures", async () => {
    const execMock = vi.fn(async () => {
      throw new Error("qmd b35b stderr failure");
    });
    const result = await searchMeetingCollections("batch35b-fail", 4, ["col-b35b"], execMock);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/qmd b35b stderr failure/i);
  });

  it("searchMeetingCollections tolerates bare array stdout", async () => {
    const execMock = vi.fn(async () => ({
      stdout: JSON.stringify([{ file: "/localhost/notes.md", snippet: "bare array b35b" }]),
      stderr: "",
    }));
    const result = await searchMeetingCollections("batch35b-array", 4, ["col-b35b"], execMock);
    expect(result.ok).toBe(true);
    expect(result.hits[0]?.content).toContain("bare array b35b");
  });

  it("aggregateSourceStatus picks weakest status across collections (156-162)", () => {
    const status = aggregateSourceStatus({
      a: { collection: "a", status: SOURCE_STATUS.indexedUnrecalled, count: 0, lastIndexAt: null },
      b: { collection: "b", status: SOURCE_STATUS.recalled, count: 3, lastIndexAt: "2026-11-12T00:00:00.000Z" },
    });
    expect(status).toBe(SOURCE_STATUS.indexedUnrecalled);
    const recalledOnly = aggregateSourceStatus({
      b: { collection: "b", status: SOURCE_STATUS.recalled, count: 3, lastIndexAt: "2026-11-12T00:00:00.000Z" },
    });
    expect(isSearchAggregateRecalled({ aggregateStatus: recalledOnly })).toBe(true);
  });

  it("isSearchAggregateRecalled false for mixed non-terminal statuses", () => {
    const status = aggregateSourceStatus({
      a: { collection: "a", status: SOURCE_STATUS.indexedUnrecalled, count: 0, lastIndexAt: null },
      b: { collection: "b", status: SOURCE_STATUS.notIndexed, count: 0, lastIndexAt: null },
    });
    expect(isSearchAggregateRecalled({ aggregateStatus: status })).toBe(false);
  });
});
