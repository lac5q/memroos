// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initSchema } from "@/lib/db-schema";
import { createSpace } from "@/lib/space";

const testDb = new Database(":memory:");
initSchema(testDb);

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("@/lib/agent-registry", () => ({
  authenticateAgentHeaders: vi.fn(() => ({ id: "agent-1" })),
}));

const { GET } = await import("../route");
const { authenticateAgentHeaders } = await import("@/lib/agent-registry");

describe("GET /api/space-cache", () => {
  let spaceId = "";

  beforeEach(() => {
    vi.mocked(authenticateAgentHeaders).mockReturnValue({ id: "agent-1" } as never);
    spaceId = createSpace(testDb, { tenantId: "default-tenant", name: `cache-${crypto.randomUUID()}` }).id;
  });

  it("returns 401 without auth", async () => {
    vi.mocked(authenticateAgentHeaders).mockReturnValueOnce(null);
    const res = await GET(new Request(`http://localhost/api/space-cache?spaceId=${spaceId}`) as never);
    expect(res.status).toBe(401);
  });

  it("returns 400 when spaceId is missing", async () => {
    const res = await GET(new Request("http://localhost/api/space-cache") as never);
    expect(res.status).toBe(400);
  });

  it("returns cache state for a space", async () => {
    const res = await GET(new Request(`http://localhost/api/space-cache?spaceId=${spaceId}`) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body).toHaveProperty("entries");
  });
});
