// @vitest-environment node
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initSchema } from "@/lib/db-schema";
import { createSpace } from "@/lib/space";

const testDb = new Database(":memory:");
initSchema(testDb);

const mockAuthenticateAgentHeaders = vi.fn();

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("@/lib/agent-registry", () => ({
  authenticateAgentHeaders: (...args: unknown[]) => mockAuthenticateAgentHeaders(...args),
}));

const LOOPBACK = "http://localhost";

describe("POST /api/write-rules batch33", () => {
  let spaceId: string;

  beforeEach(() => {
    mockAuthenticateAgentHeaders.mockReturnValue({ id: `agent-${randomUUID().slice(0, 6)}` });
    spaceId = createSpace(testDb, {
      tenantId: "default-tenant",
      name: `wr-b33-${randomUUID().slice(0, 6)}`,
    }).id;
  });

  it("tolerates invalid JSON body via empty-object fallback (L30)", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/write-rules`, {
        method: "POST",
        headers: { authorization: "Bearer k", "Content-Type": "application/json" },
        body: "{",
      }) as never,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/spaceId/i);
  });

  it("returns 401 when agent auth fails after parsing body (L33)", async () => {
    mockAuthenticateAgentHeaders.mockReturnValueOnce(null);
    const { POST } = await import("../route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/write-rules`, {
        method: "POST",
        headers: { authorization: "Bearer k", "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: "hint-agent",
          spaceId,
          dataType: "lesson",
          targetDocument: "lessons.md",
        }),
      }) as never,
    );
    expect(res.status).toBe(401);
  });
});
