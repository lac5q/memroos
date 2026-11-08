// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

import type { DispatchTask } from "@/lib/dispatch/types";

const TASK: DispatchTask = {
  task_id: `task-b31-${randomUUID().slice(0, 8)}`,
  context_id: "ctx-b31",
  from_agent: "memroos",
  to_agent: "remote",
  task_summary: "batch31 remote task parsing",
  input: { note: "coverage" },
  priority: 2,
  dispatched_at: "2026-11-08T00:00:00.000Z",
};

describe("A2A client batch31", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("remoteTaskFrom accepts nested task wrapper (line 125)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ task: { id: "nested-b31", status: { state: "working" } } }), { status: 200 }),
      ),
    );
    const { sendMessageToA2aAgent } = await import("../client");
    const result = await sendMessageToA2aAgent(
      { id: "remote-b31", host: "localhost", port: 9210, metadata: {} },
      TASK,
    );
    expect(result.accepted).toBe(true);
    expect(result.evidence).toMatchObject({ remoteTaskId: "nested-b31" });
  });

  it("remoteTaskFrom accepts flat task shape (line 127)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ id: "flat-b31", status: { state: "submitted" } }), { status: 200 }),
      ),
    );
    const { sendMessageToA2aAgent } = await import("../client");
    const result = await sendMessageToA2aAgent(
      { id: "remote-b31b", tunnelUrl: "http://localhost:9211", metadata: {} },
      TASK,
    );
    expect(result.accepted).toBe(true);
    expect(result.evidence).toMatchObject({ state: "submitted" });
  });

  it("redactUrlForDisplay strips embedded credentials when normalize fails (line 179)", async () => {
    const { redactUrlForDisplay } = await import("../client");
    expect(redactUrlForDisplay("http://user:secret@localhost:3000/hook")).toBe("http://localhost:3000/hook");
    expect(redactUrlForDisplay("not a valid url %")).toContain("not a valid url");
  });
});
