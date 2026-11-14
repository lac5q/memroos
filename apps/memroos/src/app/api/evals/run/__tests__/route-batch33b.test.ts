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

describe("POST /api/evals/run batch33b", () => {
  beforeEach(() => {
    vi.resetModules();
    authorizeRegistryWrite.mockReturnValue(true);
    scoreAndMaybePersistEvalTrace.mockReset();
    scoreAndMaybePersistEvalTrace.mockReturnValue({ score: 0.5 });
  });

  it("rejects non-object trace payloads (line 11)", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      new Request("http://localhost/api/evals/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trace: null }),
      }) as never,
    );
    expect(res.status).toBe(400);
  });

  it("treats malformed JSON bodies as missing trace (line 26)", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      new Request("http://localhost/api/evals/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{not-json",
      }) as never,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/trace with traceId/i);
  });
});
