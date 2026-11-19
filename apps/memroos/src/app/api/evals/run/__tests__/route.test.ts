// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const authorizeRegistryWrite = vi.hoisted(() => vi.fn(() => true));
const scoreAndMaybePersistEvalTrace = vi.hoisted(() => vi.fn());

vi.mock("@/lib/operator-auth", () => ({
  authorizeRegistryWrite: (...args: unknown[]) => authorizeRegistryWrite(...args),
  registryWriteUnauthorizedResponse: () => Response.json({ ok: false, error: "forbidden" }, { status: 403 }),
}));

vi.mock("@/lib/evals/service", () => ({
  scoreAndMaybePersistEvalTrace: (...args: unknown[]) => scoreAndMaybePersistEvalTrace(...args),
}));

const { POST } = await import("../route");

const trace = {
  traceId: "trace-1",
  agentId: "agent-1",
  input: "in",
  output: "out",
};

describe("POST /api/evals/run", () => {
  beforeEach(() => {
    authorizeRegistryWrite.mockReset();
    authorizeRegistryWrite.mockReturnValue(true);
    scoreAndMaybePersistEvalTrace.mockReset();
    scoreAndMaybePersistEvalTrace.mockReturnValue({ score: 0.9 });
  });

  it("returns 403 when registry write is unauthorized", async () => {
    authorizeRegistryWrite.mockReturnValueOnce(false);
    const res = await POST(new Request("http://localhost/api/evals/run", { method: "POST", body: "{}" }) as never);
    expect(res.status).toBe(403);
  });

  it("returns 400 when trace payload is invalid", async () => {
    const res = await POST(
      new Request("http://localhost/api/evals/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trace: { traceId: "only-id" } }),
      }) as never
    );
    expect(res.status).toBe(400);
  });

  it("scores trace and returns result", async () => {
    const res = await POST(
      new Request("http://localhost/api/evals/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trace, persist: false }),
      }) as never
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, result: { score: 0.9 } });
  });

  it("returns 400 when scoring throws", async () => {
    scoreAndMaybePersistEvalTrace.mockImplementationOnce(() => {
      throw new Error("bad trace");
    });
    const res = await POST(
      new Request("http://localhost/api/evals/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trace }),
      }) as never
    );
    expect(res.status).toBe(400);
  });
});
