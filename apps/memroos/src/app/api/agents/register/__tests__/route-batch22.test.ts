// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initSchema } from "@/lib/db-schema";

const testDb = new Database(":memory:");
initSchema(testDb);

const authorizeRegistryWrite = vi.hoisted(() => vi.fn(() => true));

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("@/lib/operator-auth", () => ({
  authorizeRegistryWrite: (...args: unknown[]) => authorizeRegistryWrite(...args),
  registryWriteUnauthorizedResponse: () =>
    Response.json({ ok: false, error: "unauthorized" }, { status: 403 }),
}));

const LOOPBACK = "http://localhost";

describe("POST /api/agents/register batch22", () => {
  beforeEach(() => {
    authorizeRegistryWrite.mockReset();
    authorizeRegistryWrite.mockReturnValue(true);
    vi.resetModules();
  });

  it("returns 400 when required string fields are missing", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/agents/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: `agent-b22-${randomUUID().slice(0, 8)}`,
          name: "Missing Role",
          platform: "codex",
          protocol: "rest",
        }),
      })
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when protocol is invalid", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/agents/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: `agent-b22-${randomUUID().slice(0, 8)}`,
          name: "Bad Protocol",
          role: "Worker",
          platform: "codex",
          protocol: "grpc",
        }),
      })
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when JSON body cannot be parsed", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/agents/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      })
    );
    expect(res.status).toBe(400);
  });
});
