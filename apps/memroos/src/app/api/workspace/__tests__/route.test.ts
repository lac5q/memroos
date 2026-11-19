// @vitest-environment node
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

const { GET, POST, DELETE } = await import("../route");

describe("/api/workspace", () => {
  let spaceId: string;
  let caseId = 0;

  beforeEach(() => {
    caseId += 1;
    testDb.prepare("DELETE FROM active_workspace").run();
    const space = createSpace(testDb, { tenantId: "default-tenant", name: `workspace-a-${caseId}` });
    spaceId = space.id;
  });

  it("GET returns null workspace when none loaded", async () => {
    const req = new Request("http://localhost/api/workspace", {
      method: "GET",
      headers: { authorization: "Bearer k" },
    });
    const res = await GET(req as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.workspace).toBeNull();
  });

  it("POST loads workspace for spaceId", async () => {
    const req = new Request("http://localhost/api/workspace", {
      method: "POST",
      headers: { authorization: "Bearer k", "Content-Type": "application/json" },
      body: JSON.stringify({ spaceId, isHeadless: false }),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.workspace.spaceId).toBe(spaceId);
    expect(body.workspace.isHeadless).toBe(false);
  });

  it("GET returns active workspace after load", async () => {
    await POST(
      new Request("http://localhost/api/workspace", {
        method: "POST",
        headers: { authorization: "Bearer k", "Content-Type": "application/json" },
        body: JSON.stringify({ spaceId }),
      }) as never
    );
    const res = await GET(
      new Request("http://localhost/api/workspace", {
        method: "GET",
        headers: { authorization: "Bearer k" },
      }) as never
    );
    const body = await res.json();
    expect(body.workspace?.spaceId).toBe(spaceId);
  });

  it("DELETE clears active workspace", async () => {
    await POST(
      new Request("http://localhost/api/workspace", {
        method: "POST",
        headers: { authorization: "Bearer k", "Content-Type": "application/json" },
        body: JSON.stringify({ spaceId }),
      }) as never
    );
    const del = await DELETE(
      new Request("http://localhost/api/workspace", {
        method: "DELETE",
        headers: { authorization: "Bearer k" },
      }) as never
    );
    expect(del.status).toBe(200);
    const get = await GET(
      new Request("http://localhost/api/workspace", {
        method: "GET",
        headers: { authorization: "Bearer k" },
      }) as never
    );
    const body = await get.json();
    expect(body.workspace).toBeNull();
  });

  it("POST returns 400 when spaceId missing", async () => {
    const req = new Request("http://localhost/api/workspace", {
      method: "POST",
      headers: { authorization: "Bearer k", "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
  });
});
