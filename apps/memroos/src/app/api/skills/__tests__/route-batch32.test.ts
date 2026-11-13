// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/skill-workflow", () => ({
  buildSkillWorkflowItems: vi.fn(async () => []),
  readSkillReviewState: vi.fn(async () => ({})),
}));

vi.mock("@/lib/skill-budget", () => ({
  readSkillBudgetReport: vi.fn(async () => {
    throw new Error("budget read failed");
  }),
}));

const { GET } = await import("../route");

describe("GET /api/skills batch32", () => {
  it("maps unexpected build failures to apiError (line 253)", async () => {
    const res = await GET();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/budget read failed/);
  });
});
