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

describe("/api/document-directory batch30b", () => {
  let spaceId: string;

  beforeEach(() => {
    vi.resetModules();
    mockAuthenticate.mockReturnValue({ id: `agent-${randomUUID().slice(0, 8)}` });
    const space = createSpace(testDb, {
      tenantId: "default-tenant",
      name: `doc-b30b-${randomUUID().slice(0, 6)}`,
    });
    spaceId = space.id;
  });

  it("POST parses agentId hint and space_id alias", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/document-directory`, {
        method: "POST",
        headers: { authorization: "Bearer k", "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: "hint-agent",
          space_id: spaceId,
          name: `Entry ${randomUUID().slice(0, 4)}`,
        }),
      }) as never,
    );
    expect(res.status).toBe(200);
  });

  it("POST returns 401 when agent auth fails", async () => {
    mockAuthenticate.mockReturnValueOnce(null);
    const { POST } = await import("../route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/document-directory`, {
        method: "POST",
        headers: { authorization: "Bearer k", "Content-Type": "application/json" },
        body: JSON.stringify({ spaceId, name: "x" }),
      }) as never,
    );
    expect(res.status).toBe(401);
  });

  it("POST tolerates invalid JSON body via empty-object fallback", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/document-directory`, {
        method: "POST",
        headers: { authorization: "Bearer k", "Content-Type": "application/json" },
        body: "{ not-json",
      }) as never,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/spaceId/i);
  });

  it("GET returns 500 when listing throws", async () => {
    const writeRules = await import("@/lib/write-rules");
    vi.spyOn(writeRules, "getDocumentDirectory").mockImplementation(() => {
      throw new Error(`list failed ${randomUUID().slice(0, 6)}`);
    });
    const { GET } = await import("../route");
    const res = await GET(
      new Request(`${LOOPBACK}/api/document-directory?spaceId=${spaceId}`, {
        method: "GET",
        headers: { authorization: "Bearer k" },
      }) as never,
    );
    expect(res.status).toBe(500);
    vi.restoreAllMocks();
  });
});
