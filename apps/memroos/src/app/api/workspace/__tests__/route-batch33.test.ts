// @vitest-environment node
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initSchema } from "@/lib/db-schema";
import { createSpace } from "@/lib/space";

const testDb = new Database(":memory:");
initSchema(testDb);

const mockAuthenticate = vi.fn();

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("@/lib/agent-registry", () => ({
  authenticateAgentHeaders: (...args: unknown[]) => mockAuthenticate(...args),
}));

const LOOPBACK = "http://localhost";

describe("POST /api/workspace batch33", () => {
  let spaceId: string;

  beforeEach(() => {
    mockAuthenticate.mockReturnValue({ id: `agent-${randomUUID().slice(0, 8)}` });
    spaceId = createSpace(testDb, {
      tenantId: "default-tenant",
      name: `ws-b33-${randomUUID().slice(0, 6)}`,
    }).id;
  });

  it("tolerates invalid JSON body via empty-object fallback (L25)", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/workspace`, {
        method: "POST",
        headers: { authorization: "Bearer k", "Content-Type": "application/json" },
        body: "{",
      }) as never,
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/spaceId/i);
  });

  it("returns 401 when agent auth fails (L28)", async () => {
    mockAuthenticate.mockReturnValueOnce(null);
    const { POST } = await import("../route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/workspace`, {
        method: "POST",
        headers: { authorization: "Bearer k", "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: "hint",
          space_id: spaceId,
          is_headless: true,
        }),
      }) as never,
    );
    expect(res.status).toBe(401);
  });
});
