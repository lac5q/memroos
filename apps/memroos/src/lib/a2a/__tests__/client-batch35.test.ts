// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

import type { DispatchTask } from "@/lib/dispatch/types";

function makeTask(): DispatchTask {
  return {
    task_id: `task-b35-${randomUUID().slice(0, 8)}`,
    context_id: "ctx-b35",
    from_agent: "memroos",
    to_agent: "remote-b35",
    task_summary: "batch35 remote task parsing",
    input: { note: "coverage" },
    priority: 2,
    dispatched_at: "2026-11-12T00:00:00.000Z",
  };
}

describe("A2A client batch35", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("remoteTaskFrom unwraps nested task payloads (125)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ task: { id: "nested-b35", status: { state: "working" } } }), {
          status: 200,
        }),
      ),
    );
    const { sendMessageToA2aAgent } = await import("../client");
    const result = await sendMessageToA2aAgent(
      {
        id: "remote-b35",
        host: "localhost",
        port: 9220,
        metadata: { a2a: { endpointUrl: "http://localhost:9220/a2a" } },
      },
      makeTask(),
    );
    expect(result.accepted).toBe(true);
    expect(result.evidence).toMatchObject({ remoteTaskId: "nested-b35" });
  });

  it("remoteTaskFrom accepts flat task objects with status (128)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ id: "flat-b35", status: { state: "submitted" } }), { status: 200 }),
      ),
    );
    const { sendMessageToA2aAgent } = await import("../client");
    const result = await sendMessageToA2aAgent(
      {
        id: "remote-b35b",
        tunnelUrl: "http://localhost:9221",
        metadata: {},
      },
      makeTask(),
    );
    expect(result.accepted).toBe(true);
    expect(result.evidence).toMatchObject({ state: "submitted" });
  });
});
