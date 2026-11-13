// @vitest-environment node
import { EventEmitter } from "events";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { initSchema } from "@/lib/db-schema";
import { spawn } from "child_process";

const testDb = new Database(":memory:");
initSchema(testDb);

const mockAuthenticateUser = vi.fn();

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("@/lib/auth/session", () => ({
  authenticateUser: (...args: unknown[]) => mockAuthenticateUser(...args),
}));

vi.mock("child_process", () => ({
  spawn: vi.fn(),
}));

async function loadRoute() {
  vi.resetModules();
  return import("../route");
}

async function readSseEvents(response: Response): Promise<Record<string, unknown>[]> {
  const text = await response.text();
  return text
    .split("\n\n")
    .filter(Boolean)
    .map((block) => JSON.parse(block.replace(/^data: /, "")) as Record<string, unknown>);
}

describe("POST /api/library/qmd-update batch35", () => {
  beforeEach(() => {
    mockAuthenticateUser.mockResolvedValue({
      userId: `u-b35-${randomUUID().slice(0, 6)}`,
      role: "operator",
      email: "op@example.com",
    });
    process.env.HOME = "/tmp";
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.HOME;
  });

  it("rejects reviewer role via requireRole", async () => {
    mockAuthenticateUser.mockResolvedValueOnce({
      userId: "u-reviewer",
      role: "reviewer",
      email: "rev@example.com",
    });
    const { POST } = await loadRoute();
    const res = await POST(new Request("http://localhost/api/library/qmd-update", { method: "POST" }) as never);
    expect(res.status).toBe(403);
  });

  it("emits failed event when spawn throws before start", async () => {
    vi.mocked(spawn).mockImplementation(() => {
      throw new Error("spawn blocked b35");
    });
    const { POST } = await loadRoute();
    const res = await POST(new Request("http://localhost/api/library/qmd-update", { method: "POST" }) as never);
    expect(res.status).toBe(200);
    const events = await readSseEvents(res);
    expect(events.some((e) => e.type === "failed" && String(e.error).includes("spawn blocked"))).toBe(true);
  });

  it("streams stderr lines and completes on exit code 0", async () => {
    const child = new EventEmitter() as EventEmitter & {
      pid: number;
      killed: boolean;
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: ReturnType<typeof vi.fn>;
    };
    child.pid = 9091;
    child.killed = false;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn();
    vi.mocked(spawn).mockImplementation(() => child as never);

    const { POST } = await loadRoute();
    const resPromise = POST(new Request("http://localhost/api/library/qmd-update", { method: "POST" }) as never);
    setImmediate(() => {
      child.stderr.emit("data", Buffer.from("warning: batch35 qmd\n"));
      child.emit("close", 0);
    });
    const res = await resPromise;
    const events = await readSseEvents(res);
    expect(events.some((e) => e.type === "stderr")).toBe(true);
    expect(events.some((e) => e.type === "completed")).toBe(true);
  });
});
