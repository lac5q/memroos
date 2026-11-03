// @vitest-environment node
import Database from "better-sqlite3";
import crypto from "crypto";
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

const { GET, POST } = await import("../route");
const { authenticateAgentHeaders } = await import("@/lib/agent-registry");

describe("/api/shared-space", () => {
  let spaceId = "";

  beforeEach(() => {
    vi.mocked(authenticateAgentHeaders).mockReturnValue({ id: "agent-1" } as never);
    spaceId = createSpace(testDb, {
      tenantId: "default-tenant",
      name: `shared-${crypto.randomUUID()}`,
    }).id;
  });

  it("GET returns 401 when agent auth fails", async () => {
    vi.mocked(authenticateAgentHeaders).mockReturnValueOnce(null);
    const res = await GET(new Request(`http://localhost/api/shared-space?spaceId=${spaceId}`) as never);
    expect(res.status).toBe(401);
  });

  it("GET returns 400 without spaceId", async () => {
    const res = await GET(new Request("http://localhost/api/shared-space") as never);
    expect(res.status).toBe(400);
  });

  it("GET accepts space_id alias and agent query hint", async () => {
    const res = await GET(
      new Request(`http://localhost/api/shared-space?space_id=${spaceId}&agent=agent-1`) as never
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, isShared: false });
  });

  it("POST returns 401 when agent auth fails", async () => {
    vi.mocked(authenticateAgentHeaders).mockReturnValueOnce(null);
    const res = await POST(
      new Request("http://localhost/api/shared-space", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spaceId, isShared: true }),
      }) as never
    );
    expect(res.status).toBe(401);
  });

  it("GET returns shared flag", async () => {
    const res = await GET(new Request(`http://localhost/api/shared-space?spaceId=${spaceId}`) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.isShared).toBe(false);
  });

  it("GET returns 500 when shared lookup throws", async () => {
    const shared = await import("@/lib/shared-space");
    vi.spyOn(shared, "isSpaceShared").mockImplementationOnce(() => {
      throw new Error("db unavailable");
    });
    const res = await GET(new Request(`http://localhost/api/shared-space?spaceId=${spaceId}`) as never);
    expect(res.status).toBe(500);
  });

  it("POST returns 400 when toggle throws", async () => {
    const shared = await import("@/lib/shared-space");
    vi.spyOn(shared, "setSpaceShared").mockImplementationOnce(() => {
      throw new Error("invalid toggle");
    });
    const res = await POST(
      new Request("http://localhost/api/shared-space", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spaceId, isShared: true }),
      }) as never
    );
    expect(res.status).toBe(400);
  });

  it("POST toggles shared state", async () => {
    const res = await POST(
      new Request("http://localhost/api/shared-space", {
        method: "POST",
        headers: { "Content-Type": "application/json", authorization: "Bearer test-key" },
        body: JSON.stringify({ spaceId, isShared: true, reason: "collab" }),
      }) as never
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isShared).toBe(true);
  });
});
