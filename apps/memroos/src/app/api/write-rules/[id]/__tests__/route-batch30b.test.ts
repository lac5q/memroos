// @vitest-environment node
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initSchema } from "@/lib/db-schema";
import { createSpace } from "@/lib/space";
import { createWriteRule } from "@/lib/write-rules";

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

describe("/api/write-rules/[id] batch30b", () => {
  let ruleId: number;

  beforeEach(() => {
    mockAuthenticate.mockReturnValue({ id: "agent-b30b" });
    const space = createSpace(testDb, {
      tenantId: "default-tenant",
      name: `wr-b30b-${randomUUID().slice(0, 6)}`,
    });
    ruleId = createWriteRule(testDb, {
      spaceId: space.id,
      dataType: "lesson",
      targetDocument: "lessons.md",
      actorId: "agent-b30b",
    }).id;
  });

  it("PATCH returns 401 without agent", async () => {
    mockAuthenticate.mockReturnValueOnce(null);
    const { PATCH } = await import("../route");
    const res = await PATCH(
      new Request(`${LOOPBACK}/api/write-rules/${ruleId}`, {
        method: "PATCH",
        headers: { authorization: "Bearer k", "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: 1, targetDocument: "x.md" }),
      }) as never,
      { params: Promise.resolve({ id: String(ruleId) }) },
    );
    expect(res.status).toBe(401);
  });

  it("PATCH accepts expected_version snake_case and agentId hint", async () => {
    const { PATCH } = await import("../route");
    const res = await PATCH(
      new Request(`${LOOPBACK}/api/write-rules/${ruleId}`, {
        method: "PATCH",
        headers: { authorization: "Bearer k", "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: "agent-b30b",
          expected_version: 1,
          target_document: `target-${randomUUID().slice(0, 4)}.md`,
        }),
      }) as never,
      { params: Promise.resolve({ id: String(ruleId) }) },
    );
    expect(res.status).toBe(200);
  });

  it("DELETE returns 400 on version conflict", async () => {
    const { DELETE } = await import("../route");
    const res = await DELETE(
      new Request(`${LOOPBACK}/api/write-rules/${ruleId}`, {
        method: "DELETE",
        headers: { authorization: "Bearer k", "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: 99 }),
      }) as never,
      { params: Promise.resolve({ id: String(ruleId) }) },
    );
    expect(res.status).toBe(400);
  });

  it("DELETE tolerates invalid JSON via empty-object fallback", async () => {
    const { DELETE } = await import("../route");
    const res = await DELETE(
      new Request(`${LOOPBACK}/api/write-rules/${ruleId}`, {
        method: "DELETE",
        headers: { authorization: "Bearer k", "Content-Type": "application/json" },
        body: "{",
      }) as never,
      { params: Promise.resolve({ id: String(ruleId) }) },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/expectedVersion/i);
  });
});
