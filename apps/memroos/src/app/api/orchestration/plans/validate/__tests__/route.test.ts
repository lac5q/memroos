// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const authorizeRegistryWrite = vi.hoisted(() => vi.fn(() => true));
const validateOrchestrationPlan = vi.hoisted(() => vi.fn());

vi.mock("@/lib/operator-auth", () => ({
  authorizeRegistryWrite: (...args: unknown[]) => authorizeRegistryWrite(...args),
  registryWriteUnauthorizedResponse: () => Response.json({ ok: false, error: "forbidden" }, { status: 403 }),
}));

vi.mock("@/lib/orchestration/client", () => ({
  validateOrchestrationPlan: (...args: unknown[]) => validateOrchestrationPlan(...args),
}));

const { POST } = await import("../route");

describe("POST /api/orchestration/plans/validate", () => {
  beforeEach(() => {
    authorizeRegistryWrite.mockReset();
    authorizeRegistryWrite.mockReturnValue(true);
    validateOrchestrationPlan.mockReset();
  });

  it("returns 403 when registry write is unauthorized", async () => {
    authorizeRegistryWrite.mockReturnValueOnce(false);
    const res = await POST(new Request("http://localhost/api/orchestration/plans/validate", { method: "POST", body: "{}" }));
    expect(res.status).toBe(403);
  });

  it("returns 400 when body is not a JSON object", async () => {
    const res = await POST(new Request("http://localhost/api/orchestration/plans/validate", { method: "POST", body: "[]" }));
    expect(res.status).toBe(400);
  });

  it("returns 502 when orchestration validation is unavailable", async () => {
    validateOrchestrationPlan.mockRejectedValueOnce("down");
    const res = await POST(
      new Request("http://localhost/api/orchestration/plans/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: "p1" }),
      })
    );
    expect(res.status).toBe(502);
  });

  it("returns validation result", async () => {
    validateOrchestrationPlan.mockResolvedValueOnce({ ok: true, issues: [] });
    const res = await POST(
      new Request("http://localhost/api/orchestration/plans/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: "p1" }),
      })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });
});
