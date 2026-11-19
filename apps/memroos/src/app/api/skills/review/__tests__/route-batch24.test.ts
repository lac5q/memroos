// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth/session", () => ({
  authenticateUser: vi.fn(),
}));

vi.mock("@/lib/auth/middleware-roles", () => ({
  requireRole: vi.fn(),
}));

vi.mock("@/lib/skill-workflow", () => ({
  updateSkillReviewState: vi.fn(),
}));

const LOOPBACK = "http://localhost";

function request(body: unknown): NextRequest {
  return new NextRequest(`${LOOPBACK}/api/skills/review`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("POST /api/skills/review batch24", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("returns role error for non-operator sessions and rejects invalid JSON bodies", async () => {
    const { authenticateUser } = await import("@/lib/auth/session");
    const { requireRole } = await import("@/lib/auth/middleware-roles");
    vi.mocked(authenticateUser).mockResolvedValue({
      userId: "viewer-1",
      email: "viewer@example.com",
      displayName: "Viewer",
      role: "viewer",
      tenantId: "default-tenant",
    });
    vi.mocked(requireRole).mockReturnValueOnce(
      Response.json({ error: "operator role required batch24" }, { status: 403 }),
    );

    const { POST } = await import("../route");
    const forbidden = await POST(request({ skillName: "browser", action: "save-draft" }));
    expect(forbidden.status).toBe(403);

    vi.mocked(requireRole).mockReturnValue(null);
    const invalidJson = await POST(
      new NextRequest(`${LOOPBACK}/api/skills/review`, {
        method: "POST",
        body: "{",
        headers: { "content-type": "application/json" },
      }),
    );
    expect(invalidJson.status).toBe(400);
  });

  it("returns generic review error when workflow throws a non-Error value", async () => {
    const { authenticateUser } = await import("@/lib/auth/session");
    const { requireRole } = await import("@/lib/auth/middleware-roles");
    const { updateSkillReviewState } = await import("@/lib/skill-workflow");
    vi.mocked(authenticateUser).mockResolvedValue({
      userId: "ops-1",
      email: "ops@example.com",
      displayName: "Ops",
      role: "operator",
      tenantId: "default-tenant",
    });
    vi.mocked(requireRole).mockReturnValue(null);
    vi.mocked(updateSkillReviewState).mockRejectedValueOnce("workflow blew up batch24");

    const { POST } = await import("../route");
    const res = await POST(request({ skillName: "browser", action: "request-changes" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Unable to update skill review" });
  });
});
