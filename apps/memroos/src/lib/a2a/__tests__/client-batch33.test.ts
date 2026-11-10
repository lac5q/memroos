// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

import type { DispatchTask } from "@/lib/dispatch/types";

const TASK: DispatchTask = {
  task_id: `task-b33-${randomUUID().slice(0, 8)}`,
  context_id: "ctx-b33",
  from_agent: "memroos",
  to_agent: "remote",
  task_summary: "batch33 remote task parsing",
  input: { note: "coverage" },
  priority: 2,
  dispatched_at: "2026-11-10T00:00:00.000Z",
};

describe("A2A client batch33", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("remoteTaskFrom accepts nested task wrapper (125)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ task: { id: "nested-b33", status: { state: "working" } } }), { status: 200 }),
      ),
    );
    const { sendMessageToA2aAgent } = await import("../client");
    const result = await sendMessageToA2aAgent(
      { id: "remote-b33", host: "localhost", port: 9210, metadata: {} },
      TASK,
    );
    expect(result.accepted).toBe(true);
    expect(result.evidence).toMatchObject({ remoteTaskId: "nested-b33" });
  });

  it("remoteTaskFrom accepts flat task shape (128)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ id: "flat-b33", status: { state: "submitted" } }), { status: 200 }),
      ),
    );
    const { sendMessageToA2aAgent } = await import("../client");
    const result = await sendMessageToA2aAgent(
      { id: "remote-b33b", tunnelUrl: "http://localhost:9211", metadata: {} },
      TASK,
    );
    expect(result.accepted).toBe(true);
    expect(result.evidence).toMatchObject({ state: "submitted" });
  });
});
