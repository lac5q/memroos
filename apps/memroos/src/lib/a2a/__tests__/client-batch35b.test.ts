// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

import type { DispatchTask } from "@/lib/dispatch/types";

function makeTask(): DispatchTask {
  return {
    task_id: `task-b35b-${randomUUID().slice(0, 8)}`,
    context_id: "ctx-b35b",
    from_agent: "memroos",
    to_agent: "remote-b35b",
    task_summary: "batch35b remote parsing",
    input: { note: "coverage" },
    priority: 2,
    dispatched_at: "2026-11-12T00:00:00.000Z",
  };
}

describe("A2A client batch35b", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("remoteTaskFrom accepts flat task objects without nested task wrapper (128)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ id: `flat-b35b-${randomUUID().slice(0, 6)}`, status: { state: "working" } }), {
          status: 200,
        }),
      ),
    );
    const { sendMessageToA2aAgent } = await import("../client");
    const result = await sendMessageToA2aAgent(
      {
        id: "remote-flat-b35b",
        host: "localhost",
        port: 9222,
        metadata: { a2a: { endpointUrl: "http://localhost:9222/a2a" } },
      },
      makeTask(),
    );
    expect(result.accepted).toBe(true);
    expect(result.evidence).toMatchObject({ state: "working" });
  });

  it("remoteTaskFrom returns null for unrelated JSON payloads (128 null arm)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ unrelated: true }), { status: 200 })),
    );
    const { sendMessageToA2aAgent } = await import("../client");
    const result = await sendMessageToA2aAgent(
      {
        id: "remote-null-b35b",
        host: "localhost",
        port: 9223,
        metadata: { a2a: { endpointUrl: "http://localhost:9223/a2a" } },
      },
      makeTask(),
    );
    expect(result.accepted).toBe(true);
    expect(result.evidence).toMatchObject({ remoteTask: null });
  });
});
