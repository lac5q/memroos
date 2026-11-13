// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  process.env.PAPERCLIP_BASE_URL = "http://localhost:3100";
  process.env.PAPERCLIP_BUDGET_PATH = "/api/budget";
  vi.restoreAllMocks();
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /api/paperclip/budget batch36b", () => {
  it("aborts upstream fetch when budget call hangs (67)", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init?: { signal?: AbortSignal }) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
          }),
      ),
    );
    const { GET } = await import("../route");
    const pending = GET();
    await vi.advanceTimersByTimeAsync(6000);
    const res = await pending;
    expect(res.status).toBe(502);
    vi.useRealTimers();
  });
});
