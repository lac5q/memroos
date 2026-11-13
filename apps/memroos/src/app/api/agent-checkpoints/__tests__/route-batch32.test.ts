// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/operator-auth", () => ({
  authorizeRegistryWrite: () => true,
  registryWriteUnauthorizedResponse: () => Response.json({ ok: false }, { status: 401 }),
}));

const resumeFromCheckpoint = vi.hoisted(() => vi.fn());

vi.mock("@/lib/agent-checkpoints", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agent-checkpoints")>();
  return {
    ...actual,
    resumeFromCheckpoint: (...args: unknown[]) => resumeFromCheckpoint(...args),
  };
});

const TMP = path.join(os.tmpdir(), `agent-checkpoints-b32-${randomUUID()}`);

beforeEach(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
  process.env.SQLITE_DB_PATH = path.join(TMP, `${randomUUID()}.db`);
  resumeFromCheckpoint.mockReset();
});

afterEach(async () => {
  const { closeDb } = await import("@/lib/db");
  closeDb();
  delete process.env.SQLITE_DB_PATH;
  fs.rmSync(TMP, { recursive: true, force: true });
  vi.resetModules();
});

describe("agent-checkpoints route batch32", () => {
  it("GET returns 500 when resumeFromCheckpoint throws (lines 65-66)", async () => {
    resumeFromCheckpoint.mockImplementation(() => {
      throw new Error(`resume-fail-${randomUUID()}`);
    });
    const { GET } = await import("../route");
    const res = await GET(
      new Request(`http://localhost/api/agent-checkpoints?runId=run-${randomUUID().slice(0, 8)}`),
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.status).toBe("error");
    expect(body.message).toMatch(/resume-fail/);
  });

  it("POST returns 400 with Unknown error for non-Error throws (branch line 30)", async () => {
    const createAgentCheckpoint = vi.fn(() => {
      throw "string-failure";
    });
    vi.doMock("@/lib/agent-checkpoints", () => ({
      createAgentCheckpoint,
      resumeFromCheckpoint,
    }));
    const { POST } = await import("../route");
    const res = await POST(
      new Request("http://localhost/api/agent-checkpoints", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId: `run-${randomUUID().slice(0, 8)}`, ownerAgentId: "a1" }),
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ status: "error", message: "Unknown error" });
  });
});
