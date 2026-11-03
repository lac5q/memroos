// @vitest-environment node
import { EventEmitter } from "events";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

function makePostRequest(signal?: AbortSignal): Request {
  return new Request("http://localhost/api/library/qmd-update", { method: "POST", signal });
}

async function readSseEvents(response: Response): Promise<Record<string, unknown>[]> {
  const text = await response.text();
  return text
    .split("\n\n")
    .filter(Boolean)
    .map((block) => JSON.parse(block.replace(/^data: /, "")) as Record<string, unknown>);
}

describe("POST /api/library/qmd-update batch17 — runtime guard branches", () => {
  beforeEach(() => {
    mockAuthenticateUser.mockResolvedValue({
      userId: "u1",
      role: "operator",
      email: "op@example.com",
    });
    process.env.HOME = "/tmp";
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    delete process.env.HOME;
  });

  it("finalizes timeout and closes stream when qmd exceeds max runtime", async () => {
    vi.useFakeTimers();
    const child = new EventEmitter() as EventEmitter & {
      pid: number;
      killed: boolean;
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: ReturnType<typeof vi.fn>;
    };
    child.pid = 5555;
    child.killed = false;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn(() => {
      child.killed = true;
    });
    vi.mocked(spawn).mockImplementation(() => child as never);

    const { POST } = await loadRoute();
    const resPromise = POST(makePostRequest() as never);
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000 + 1);
    const res = await resPromise;
    const events = await readSseEvents(res);
    expect(child.kill).toHaveBeenCalled();
    expect(events.some((e) => e.type === "failed" && String(e.error).includes("maximum runtime"))).toBe(true);
    vi.useRealTimers();
  });

  it("ignores enqueue after stream close when child exits quickly", async () => {
    const child = new EventEmitter() as EventEmitter & {
      pid: number;
      killed: boolean;
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: ReturnType<typeof vi.fn>;
    };
    child.pid = 6060;
    child.killed = false;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn();
    vi.mocked(spawn).mockImplementation(() => {
      setImmediate(() => child.emit("close", 0));
      return child as never;
    });

    const { POST } = await loadRoute();
    const res = await POST(makePostRequest() as never);
    expect(res.status).toBe(200);
    const events = await readSseEvents(res);
    expect(events.some((e) => e.type === "completed")).toBe(true);
  });
});
