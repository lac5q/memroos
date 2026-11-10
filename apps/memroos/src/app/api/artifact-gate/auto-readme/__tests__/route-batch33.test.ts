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

describe("/api/artifact-gate/auto-readme batch33", () => {
  let spaceId: string;

  beforeEach(() => {
    mockAuthenticate.mockReturnValue({ id: `agent-${randomUUID().slice(0, 6)}` });
    spaceId = createSpace(testDb, {
      tenantId: "default-tenant",
      name: `readme-b33-${randomUUID().slice(0, 6)}`,
    }).id;
  });

  it("POST tolerates invalid JSON via empty-object fallback (L30)", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/artifact-gate/auto-readme`, {
        method: "POST",
        headers: { authorization: "Bearer k", "Content-Type": "application/json" },
        body: "{",
      }) as never,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/spaceId/i);
  });

  it("POST returns 401 when agent auth fails (L33)", async () => {
    mockAuthenticate.mockReturnValueOnce(null);
    const { POST } = await import("../route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/artifact-gate/auto-readme`, {
        method: "POST",
        headers: { authorization: "Bearer k", "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: "hint",
          spaceId,
          enabled: true,
        }),
      }) as never,
    );
    expect(res.status).toBe(401);
  });
});
