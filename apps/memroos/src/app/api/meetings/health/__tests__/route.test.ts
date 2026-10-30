// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SOURCE_STATUS } from "@/lib/meeting-source-status";

const searchMeetingCollections = vi.fn();

vi.mock("@/lib/meeting-qmd-recall", () => ({
  searchMeetingCollections,
}));

const { GET } = await import("../route");

describe("GET /api/meetings/health", () => {
  beforeEach(() => {
    searchMeetingCollections.mockReset();
  });

  it("returns collection status snapshot for empty query", async () => {
    searchMeetingCollections.mockResolvedValue({
      collectionStatus: {
        meetings: { status: SOURCE_STATUS.indexedUnrecalled, count: 0, lastIndexAt: null },
      },
      aggregateStatus: SOURCE_STATUS.indexedUnrecalled,
    });
    const res = await GET(new Request("http://localhost/api/meetings/health"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.query).toBe("");
    expect(data.collections.meetings.status).toBe(SOURCE_STATUS.indexedUnrecalled);
    expect(data.healthy).toBe(false);
    expect(searchMeetingCollections).toHaveBeenCalledWith("__memroos-meetings-health__", 1);
  });

  it("passes trimmed q to searchMeetingCollections", async () => {
    searchMeetingCollections.mockResolvedValue({
      collectionStatus: {},
      aggregateStatus: SOURCE_STATUS.recalled,
    });
    await GET(new Request("http://localhost/api/meetings/health?q=standup"));
    expect(searchMeetingCollections).toHaveBeenCalledWith("standup", 1);
  });

  it("returns 500 when probe fails", async () => {
    searchMeetingCollections.mockRejectedValue(new Error("qmd down"));
    const res = await GET(new Request("http://localhost/api/meetings/health?q=x"));
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe("meetings/health probe failed");
    expect(data.detail).toBe("qmd down");
  });
});
