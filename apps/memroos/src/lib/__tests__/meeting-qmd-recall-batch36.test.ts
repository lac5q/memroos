// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { searchMeetingCollections } from "@/lib/meeting-qmd-recall";

describe("meeting-qmd-recall batch36", () => {
  it("searchMeetingCollections parses envelope object stdout (hits branch)", async () => {
    const execMock = vi.fn(async () => ({
      stdout: JSON.stringify({
        hits: [{ file: "/localhost/meeting-b36.md", snippet: "envelope object batch36" }],
      }),
      stderr: "",
    }));
    const result = await searchMeetingCollections("batch36-envelope", 4, ["col-b36"], execMock);
    expect(result.ok).toBe(true);
    expect(result.hits[0]?.content).toContain("envelope object batch36");
  });

  it("searchMeetingCollections returns ok false when stdout is not json", async () => {
    const execMock = vi.fn(async () => ({
      stdout: "not-json-batch36",
      stderr: "",
    }));
    const result = await searchMeetingCollections("batch36-bad-json", 4, ["col-b36"], execMock);
    expect(result.ok).toBe(false);
  });
});
