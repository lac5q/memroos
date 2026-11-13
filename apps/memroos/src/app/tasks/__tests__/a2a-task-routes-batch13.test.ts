// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  agent: { id: "agent-1", name: "Agent" },
}));

vi.mock("@/lib/agent-registry", () => ({
  authenticateAgentHeaders: vi.fn(() => auth.agent),
}));

const tasks = vi.hoisted(() => ({
  cancelA2aTask: vi.fn(),
  subscribeA2aTask: vi.fn(),
}));

vi.mock("@/lib/a2a/task-service", () => tasks);

vi.mock("@/lib/a2a/errors", () => ({
  A2aError: class A2aError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
  a2aErrorResponse: (error: { code: string; message: string }) =>
    Response.json({ error: error.message, code: error.code }, { status: 400 }),
}));

describe("A2A task routes batch13", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("POST cancel returns task payload and maps unknown errors", async () => {
    tasks.cancelA2aTask.mockResolvedValueOnce({ id: "task-9", status: "canceled" });
    const { POST } = await import("../[id]:cancel/route");
    const ok = await POST(new Request("https://memroos.test/tasks/task-9:cancel", { method: "POST" }));
    expect(await ok.json()).toEqual({ id: "task-9", status: "canceled" });

    tasks.cancelA2aTask.mockRejectedValueOnce(new Error("db down"));
    const { POST: POSTAgain } = await import("../[id]:cancel/route");
    const err = await POSTAgain(new Request("https://memroos.test/tasks/task-9:cancel", { method: "POST" }));
    expect(err.status).toBe(400);
    expect(await err.json()).toMatchObject({ code: "INTERNAL" });
  });

  it("POST subscribe streams task updates and maps unknown errors", async () => {
    tasks.subscribeA2aTask.mockResolvedValueOnce({
      task: { id: "task-1", status: "working" },
      events: [{ type: "update", status: "working" }],
    });
    const { POST } = await import("../[id]:subscribe/route");
    const ok = await POST(new Request("https://memroos.test/tasks/task-1:subscribe", { method: "POST" }));
    expect(ok.headers.get("content-type")).toContain("text/event-stream");
    expect(await ok.text()).toContain("task.update");

    tasks.subscribeA2aTask.mockRejectedValueOnce(new Error("subscribe failed"));
    const { POST: POSTAgain } = await import("../[id]:subscribe/route");
    const err = await POSTAgain(new Request("https://memroos.test/tasks/task-1:subscribe", { method: "POST" }));
    expect(err.status).toBe(400);
    expect(await err.json()).toMatchObject({ code: "INTERNAL" });
  });
});
