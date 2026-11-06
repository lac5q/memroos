// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DispatchTask } from "@/lib/dispatch/types";

const TASK: DispatchTask = {
  task_id: "task-b20b",
  context_id: "ctx-b20b",
  from_agent: "memroos",
  to_agent: "remote",
  task_summary: "batch20b ping",
  input: { note: "coverage" },
  priority: 2,
  dispatched_at: "2026-07-01T00:00:00.000Z",
};

describe("A2A client batch20b", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.A2A_REMOTE_SECRET;
  });

  it("sendMessageToA2aAgent attaches bearer auth from metadata envKey", async () => {
    process.env.A2A_REMOTE_SECRET = "remote-secret-batch20b";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "remote-task", status: { state: "working" } }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { sendMessageToA2aAgent } = await import("../client");
    const result = await sendMessageToA2aAgent(
      {
        id: "remote",
        tunnelUrl: "http://localhost:9100",
        metadata: { a2a: { outboundAuth: { envKey: "A2A_REMOTE_SECRET" } } },
      },
      TASK,
    );
    expect(result.accepted).toBe(true);
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer remote-secret-batch20b");
  });

  it("cancelRemoteA2aTask surfaces non-OK responses as rejected", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("bad gateway", { status: 502 })),
    );
    const { cancelRemoteA2aTask } = await import("../client");
    const result = await cancelRemoteA2aTask(
      { id: "remote", host: "localhost", port: 9101, metadata: {} },
      "task-502",
    );
    expect(result.accepted).toBe(false);
    expect(result.detail).toMatch(/502/);
  });

  it("getRemoteA2aTask rejects when agent endpoint is not configured", async () => {
    const { getRemoteA2aTask } = await import("../client");
    await expect(getRemoteA2aTask({ id: "no-endpoint", metadata: {} }, "task-x")).rejects.toThrow();
  });
});
