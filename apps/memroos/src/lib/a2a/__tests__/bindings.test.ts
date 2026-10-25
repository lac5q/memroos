// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/a2a/task-service", () => ({
  sendA2aMessage: vi.fn(async () => ({ taskId: "t1" })),
  getA2aTaskForAgent: vi.fn(async () => ({ id: "t1" })),
  listA2aTasks: vi.fn(async () => []),
  cancelA2aTask: vi.fn(async () => ({ id: "t1", status: "canceled" })),
}));

import type { RegisteredAgent } from "@/types";

import { A2A_HTTP_JSON_ROUTES, A2A_JSON_RPC_METHODS, dispatchA2aJsonRpc } from "../bindings";

describe("A2A JSON-RPC bindings", () => {
  it("exports route and method catalogs", () => {
    expect(A2A_HTTP_JSON_ROUTES).toContain("/tasks/{id}:subscribe");
    expect(A2A_JSON_RPC_METHODS).toContain("tasks/cancel");
  });

  it("rejects invalid JSON-RPC envelopes", async () => {
    await expect(dispatchA2aJsonRpc(null, { jsonrpc: "1.0" })).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
  });

  it("blocks streaming methods with JSON-RPC error", async () => {
    const res = await dispatchA2aJsonRpc(null, {
      jsonrpc: "2.0",
      id: 1,
      method: "message/stream",
      params: {},
    });
    expect(res.error?.message).toMatch(/Streaming methods/);
  });

  it("returns method not found for unknown methods", async () => {
    const res = await dispatchA2aJsonRpc(null, {
      jsonrpc: "2.0",
      id: "x",
      method: "tasks/unknown",
      params: {},
    });
    expect(res.error?.code).toBe(-32601);
  });

  it("dispatches tasks/get when taskId is provided", async () => {
    const res = await dispatchA2aJsonRpc(null, {
      jsonrpc: "2.0",
      id: "g1",
      method: "tasks/get",
      params: { taskId: "task-42" },
    });
    expect(res.result).toEqual({ id: "t1" });
  });

  it("dispatches tasks/list for authenticated agents", async () => {
    const agent = {
      id: "agent-a",
      name: "A",
      role: "worker",
      platform: "codex",
      protocol: "rest",
      status: "active",
    } as RegisteredAgent;
    const res = await dispatchA2aJsonRpc(agent, {
      jsonrpc: "2.0",
      id: null,
      method: "tasks/list",
      params: {},
    });
    expect(res.result).toEqual([]);
  });
});
