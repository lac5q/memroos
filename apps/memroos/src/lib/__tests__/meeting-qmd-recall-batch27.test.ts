// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  aggregateSourceStatus,
  searchMeetingCollections,
} from "@/lib/meeting-qmd-recall";
import { SOURCE_STATUS } from "@/lib/meeting-source-status";

describe("meeting-qmd-recall batch27 — aggregate empty, primitive hits, metadata without indexedAt", () => {
  it("aggregateSourceStatus returns providerAbsent for an empty collection map", () => {
    expect(aggregateSourceStatus({})).toBe(SOURCE_STATUS.providerAbsent);
  });

  it("searchMeetingCollections normalizes primitive array hits and preserves raw metadata when no indexed_at", async () => {
    const execMock = async () => ({
      stdout: JSON.stringify(["plain-string-hit", { file: "/meetings/doc.md", title: "Doc", text: "body" }]),
      stderr: "",
    });
    const result = await searchMeetingCollections("batch27", 5, ["meet-recordings-b27-primitive"], execMock);
    expect(result.ok).toBe(true);
    expect(result.hits.some((h) => h.content === "plain-string-hit")).toBe(true);
    const docHit = result.hits.find((h) => h.title === "Doc");
    expect(docHit?.metadata).toMatchObject({ file: "/meetings/doc.md" });
    expect(docHit?.metadata && typeof docHit.metadata === "object" && "indexedAt" in docHit.metadata).toBe(false);
  });
});
