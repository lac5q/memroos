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

async function readSseEvents(response: Response): Promise<Record<string, unknown>[]> {
  const text = await response.text();
  return text
    .split("\n\n")
    .filter(Boolean)
    .map((block) => JSON.parse(block.replace(/^data: /, "")) as Record<string, unknown>);
}

describe("POST /api/library/qmd-update batch33b — close() idempotency (line 74)", () => {
  beforeEach(() => {
    mockAuthenticateUser.mockResolvedValue({
      userId: "u-b33b",
      role: "operator",
      email: "op@example.com",
    });
    process.env.HOME = "/tmp";
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.HOME;
  });

  it("ignores duplicate close when abort races child completion", async () => {
    const child = new EventEmitter() as EventEmitter & {
      pid: number;
      killed: boolean;
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: ReturnType<typeof vi.fn>;
    };
    child.pid = 8088;
    child.killed = false;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn();
    vi.mocked(spawn).mockImplementation(() => child as never);

    const abort = new AbortController();
    const { POST } = await loadRoute();
    const resPromise = POST(
      new Request("http://localhost/api/library/qmd-update", {
        method: "POST",
        signal: abort.signal,
      }) as never,
    );

    setImmediate(() => {
      child.emit("close", 0);
      abort.abort();
    });

    const res = await resPromise;
    expect(res.status).toBe(200);
    const events = await readSseEvents(res);
    expect(events.some((e) => e.type === "completed")).toBe(true);
  });
});
