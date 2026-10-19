// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";

const testDb = new Database(":memory:");
initSchema(testDb);

const mockAuthenticateUser = vi.fn();
const mockAuthenticateAgent = vi.fn();

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("@/lib/auth/session", () => ({
  authenticateUser: (...args: unknown[]) => mockAuthenticateUser(...args),
}));

vi.mock("@/lib/agent-registry", () => ({
  authenticateAgentHeaders: (...args: unknown[]) => mockAuthenticateAgent(...args),
}));

vi.mock("@/lib/knowledge-collections", () => ({
  loadCollections: vi.fn(() => []),
  collectCollectionFiles: vi.fn(async () => []),
}));

vi.mock("fs/promises", () => ({
  stat: vi.fn(async () => ({ mtime: new Date("2026-01-01T00:00:00.000Z") })),
}));

const LOOPBACK = "http://localhost";

describe("long-tail batch 12 — API routes", () => {
  beforeEach(() => {
    mockAuthenticateUser.mockReset();
    mockAuthenticateAgent.mockReset();
    mockAuthenticateUser.mockResolvedValue({
      userId: "op-1",
      role: "operator",
      email: "op@example.com",
    });
    mockAuthenticateAgent.mockReturnValue({ id: "agent-1", name: "Agent" });
  });

  it("GET /api/library/freshness returns empty qmd state when table is empty", async () => {
    testDb.exec(`
      CREATE TABLE IF NOT EXISTS memory_qmd_updates (
        id TEXT PRIMARY KEY,
        target_path TEXT NOT NULL,
        source_hash TEXT NOT NULL,
        status TEXT NOT NULL,
        freshness_timestamp TEXT NOT NULL,
        last_success_timestamp TEXT
      );
      DELETE FROM memory_qmd_updates;
    `);
    const { GET } = await import("../library/freshness/route");
    const res = await GET(new Request(`${LOOPBACK}/api/library/freshness`) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.qmd.updateId).toBeNull();
    expect(body.qmd.status).toBeNull();
    expect(body.collections).toEqual([]);
  });

  it("GET /api/write-rules requires spaceId on list", async () => {
    const { GET } = await import("../write-rules/route");
    const res = await GET(new Request(`${LOOPBACK}/api/write-rules`, { method: "GET" }) as never);
    expect(res.status).toBe(400);
  });

  it("GET /api/write-rules lists rules for a space", async () => {
    const { createSpace } = await import("@/lib/space");
    const space = createSpace(testDb, {
      tenantId: "default-tenant",
      name: `b12-wr-${randomUUID()}`,
    });
    const { GET } = await import("../write-rules/route");
    const res = await GET(
      new Request(`${LOOPBACK}/api/write-rules?spaceId=${space.id}`, {
        headers: { "x-agent-id": "agent-1" },
      }) as never
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.rules)).toBe(true);
  });

  it("POST /api/write-rules rejects missing spaceId", async () => {
    const { POST } = await import("../write-rules/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/write-rules`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-agent-id": "agent-1" },
        body: JSON.stringify({ dataType: "note", targetDocument: "doc.md" }),
      }) as never
    );
    expect(res.status).toBe(400);
  });

  it("GET /api/memory-stats returns tier stats shape", async () => {
    const { GET } = await import("../memory-stats/route");
    const res = await GET(new Request(`${LOOPBACK}/api/memory-stats`) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("tierStats");
    expect(body).toHaveProperty("timestamp");
  });

  it("GET /api/time-series rejects unknown metric", async () => {
    const { GET } = await import("../time-series/route");
    const res = await GET(
      new Request(`${LOOPBACK}/api/time-series?metric=not_real&window=day`) as never
    );
    expect(res.status).toBe(400);
  });

  it("POST /api/policy/knowledge rejects caller-supplied ontologyContext", async () => {
    const { POST } = await import("../policy/knowledge/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/policy/knowledge`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "read",
          ontologyContext: { ontologyId: "forged" },
        }),
      }) as never
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: expect.stringContaining("ontology context"),
    });
  });

  it("POST /api/skills/sync/check validates required sync fields", async () => {
    const { POST } = await import("../skills/sync/check/route");
    const badBody = await POST(
      new Request(`${LOOPBACK}/api/skills/sync/check`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }) as never
    );
    expect(badBody.status).toBe(400);
  });
});
