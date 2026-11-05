// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/tool-attention", () => ({
  getSimilarTaskRecommendations: vi.fn(() => ({
    context: { task_type: "review" },
    recommendations: [
      { capabilityId: "skill:foo", name: "foo", description: "d", type: "skill",
        contextScore: 3, overallScore: 9, reason: "r" },
    ],
    timestamp: "2026-05-04T00:00:00.000Z",
  })),
}));

const { GET } = await import("../route");
const { getSimilarTaskRecommendations } = await import("@/lib/tool-attention");

describe("GET /api/tool-attention/similar", () => {
  it("returns recommendations matching context pack", async () => {
    const req = new NextRequest(
      "http://localhost/api/tool-attention/similar?task_type=review&repo=myrepo"
    );
    const res = await GET(req);
    const body = await res.json();
    expect(getSimilarTaskRecommendations).toHaveBeenCalledWith(
      expect.objectContaining({ task_type: "review", repo: "myrepo" }),
      10
    );
    expect(body.recommendations).toHaveLength(1);
  });

  it("omits task field from JSONL records in output", async () => {
    const req = new NextRequest("http://localhost/api/tool-attention/similar");
    const res = await GET(req);
    const text = await res.text();
    expect(text).not.toContain('"task"');
  });

  it("parses comma-separated tags and clamps invalid limits", async () => {
    const req = new NextRequest(
      "http://localhost/api/tool-attention/similar?tags=alpha,beta&limit=not-a-number"
    );
    await GET(req);
    expect(getSimilarTaskRecommendations).toHaveBeenCalledWith(
      expect.objectContaining({ tags: ["alpha", "beta"] }),
      10
    );
  });

  it("falls back to empty array when no outcomes exist", async () => {
    vi.mocked(getSimilarTaskRecommendations).mockReturnValueOnce({
      context: {},
      recommendations: [],
      timestamp: "2026-05-04T00:00:00.000Z",
    });
    const req = new NextRequest("http://localhost/api/tool-attention/similar");
    const res = await GET(req);
    const body = await res.json();
    expect(body.recommendations).toEqual([]);
  });
});
