// @vitest-environment node
import { describe, expect, it, vi, afterEach } from "vitest";
import type { DispatchTask } from "@/lib/dispatch/types";

const TASK: DispatchTask = {
  task_id: "task-b15",
  context_id: "ctx-b15",
  from_agent: "memroos",
  to_agent: "remote",
  task_summary: "ping",
  input: {},
  priority: 1,
  dispatched_at: "2026-07-01T00:00:00.000Z",
};

describe("A2A client batch15 branches", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("builds endpoint from host/port and parses nested task payloads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ task: { id: "remote-1", status: { state: "completed" } } }), {
          status: 200,
        }),
      ),
    );
    const { getRemoteA2aTask, redactUrlForDisplay } = await import("../client");
    const result = await getRemoteA2aTask(
      { id: "remote", host: "localhost", port: 9001, metadata: {} },
      "remote-1",
    );
    expect(result.accepted).toBe(true);
    expect(redactUrlForDisplay("not-a-url://user@host")).toContain("host");
  });

  it("redactUrlForDisplay falls back when URL parsing fails", async () => {
    const { redactUrlForDisplay } = await import("../client");
    expect(redactUrlForDisplay("https://user:pass@example.com/path")).toBe("https://example.com/path");
  });
});
