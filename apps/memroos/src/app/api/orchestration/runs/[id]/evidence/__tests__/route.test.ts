// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const authorizeRegistryWrite = vi.hoisted(() => vi.fn(() => true));
const getOrchestrationRunEvidence = vi.hoisted(() => vi.fn());

vi.mock("@/lib/operator-auth", () => ({
  authorizeRegistryWrite: (...args: unknown[]) => authorizeRegistryWrite(...args),
  registryWriteUnauthorizedResponse: () => Response.json({ ok: false, error: "forbidden" }, { status: 403 }),
}));

vi.mock("@/lib/orchestration/client", () => ({
  getOrchestrationRunEvidence: (...args: unknown[]) => getOrchestrationRunEvidence(...args),
}));

const { GET } = await import("../route");

describe("GET /api/orchestration/runs/[id]/evidence", () => {
  beforeEach(() => {
    authorizeRegistryWrite.mockReset();
    authorizeRegistryWrite.mockReturnValue(true);
    getOrchestrationRunEvidence.mockReset();
  });

  it("returns 403 when registry write is unauthorized", async () => {
    authorizeRegistryWrite.mockReturnValueOnce(false);
    const res = await GET(new Request("http://localhost/api/orchestration/runs/r1/evidence"), {
      params: Promise.resolve({ id: "r1" }),
    });
    expect(res.status).toBe(403);
  });

  it("returns 404 when no evidence bundle exists", async () => {
    getOrchestrationRunEvidence.mockResolvedValueOnce({ ok: true, bundle: null });
    const res = await GET(new Request("http://localhost/api/orchestration/runs/r1/evidence"), {
      params: Promise.resolve({ id: "r1" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 502 when orchestration client fails", async () => {
    getOrchestrationRunEvidence.mockRejectedValueOnce(new Error("evidence down"));
    const res = await GET(new Request("http://localhost/api/orchestration/runs/r1/evidence"), {
      params: Promise.resolve({ id: "r1" }),
    });
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ status: "unavailable" });
  });

  it("returns evidence bundle on success", async () => {
    getOrchestrationRunEvidence.mockResolvedValueOnce({ ok: true, bundle: { id: "b1" } });
    const res = await GET(new Request("http://localhost/api/orchestration/runs/r1/evidence"), {
      params: Promise.resolve({ id: "r1" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ bundle: { id: "b1" } });
  });
});
