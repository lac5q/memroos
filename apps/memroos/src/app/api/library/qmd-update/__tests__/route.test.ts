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

function makePostRequest(): Request {
  return new Request("http://localhost/api/library/qmd-update", { method: "POST" });
}

async function readSseEvents(response: Response): Promise<Record<string, unknown>[]> {
  const text = await response.text();
  return text
    .split("\n\n")
    .filter(Boolean)
    .map((block) => {
      const line = block.replace(/^data: /, "");
      return JSON.parse(line) as Record<string, unknown>;
    });
}

describe("POST /api/library/qmd-update", () => {
  beforeEach(() => {
    mockAuthenticateUser.mockResolvedValue({
      userId: "u1",
      role: "operator",
      email: "op@example.com",
    });
    process.env.HOME = "/tmp";
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.HOME;
    delete process.env.QMD_BIN;
  });

  it("returns 401 when unauthenticated", async () => {
    mockAuthenticateUser.mockResolvedValueOnce(null);
    const { POST } = await loadRoute();
    const res = await POST(makePostRequest() as never);
    expect(res.status).toBe(401);
  });

  it("returns 403 when role is below operator", async () => {
    mockAuthenticateUser.mockResolvedValueOnce({
      userId: "u1",
      role: "reviewer",
      email: "rev@example.com",
    });
    const { POST } = await loadRoute();
    const res = await POST(makePostRequest() as never);
    expect(res.status).toBe(403);
  });

  it("streams SSE through a successful qmd update", async () => {
    const child = new EventEmitter() as EventEmitter & {
      pid: number;
      killed: boolean;
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: ReturnType<typeof vi.fn>;
    };
    child.pid = 4242;
    child.killed = false;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn(() => {
      child.killed = true;
    });

    vi.mocked(spawn).mockImplementation(() => {
      setImmediate(() => {
        child.stdout.emit("data", Buffer.from("indexed 1 doc\n"));
        child.emit("close", 0);
      });
      return child as never;
    });

    const { POST } = await loadRoute();
    const res = await POST(makePostRequest() as never);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");

    const events = await readSseEvents(res);
    expect(events.some((e) => e.type === "queued")).toBe(true);
    expect(events.some((e) => e.type === "started" && e.pid === 4242)).toBe(true);
    expect(events.some((e) => e.type === "stdout")).toBe(true);
    expect(events.some((e) => e.type === "completed" && e.exitCode === 0)).toBe(true);
  });

  it("streams failed when spawn throws", async () => {
    vi.mocked(spawn).mockImplementation(() => {
      throw new Error("qmd binary missing");
    });

    const { POST } = await loadRoute();
    const res = await POST(makePostRequest() as never);
    const events = await readSseEvents(res);
    expect(events.some((e) => e.type === "failed" && String(e.error).includes("qmd binary missing"))).toBe(
      true
    );
  });
});
