// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const authorizeRegistryWrite = vi.hoisted(() => vi.fn(() => true));
const resolveOrchestrationHil = vi.hoisted(() => vi.fn());

vi.mock("@/lib/operator-auth", () => ({
  authorizeRegistryWrite: (...args: unknown[]) => authorizeRegistryWrite(...args),
  registryWriteUnauthorizedResponse: () => Response.json({ ok: false, error: "forbidden" }, { status: 403 }),
}));

vi.mock("@/lib/orchestration/client", () => ({
  resolveOrchestrationHil: (...args: unknown[]) => resolveOrchestrationHil(...args),
}));

const { POST } = await import("../route");

describe("POST /api/orchestration/hil/[id]", () => {
  beforeEach(() => {
    authorizeRegistryWrite.mockReset();
    authorizeRegistryWrite.mockReturnValue(true);
    resolveOrchestrationHil.mockReset();
  });

  it("returns 403 when registry write is unauthorized", async () => {
    authorizeRegistryWrite.mockReturnValueOnce(false);
    const res = await POST(
      new Request("http://localhost/api/orchestration/hil/h1", {
        method: "POST",
        body: JSON.stringify({ decision: "approve" }),
      }),
      { params: Promise.resolve({ id: "h1" }) }
    );
    expect(res.status).toBe(403);
  });

  it("returns 400 for invalid decision payloads", async () => {
    const res = await POST(
      new Request("http://localhost/api/orchestration/hil/h1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "maybe" }),
      }),
      { params: Promise.resolve({ id: "h1" }) }
    );
    expect(res.status).toBe(400);
  });

  it("returns 502 when orchestration HIL client fails", async () => {
    resolveOrchestrationHil.mockRejectedValueOnce(new Error("hil down"));
    const res = await POST(
      new Request("http://localhost/api/orchestration/hil/h1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "reject" }),
      }),
      { params: Promise.resolve({ id: "h1" }) }
    );
    expect(res.status).toBe(502);
  });

  it("returns HIL resolution on success", async () => {
    resolveOrchestrationHil.mockResolvedValueOnce({ ok: true, decision: "approve" });
    const res = await POST(
      new Request("http://localhost/api/orchestration/hil/h1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "approve" }),
      }),
      { params: Promise.resolve({ id: "h1" }) }
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, decision: "approve" });
  });
});
