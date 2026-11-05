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

const { GET, POST } = await import("../route");

describe("/api/document-directory", () => {
  let spaceId: string;
  let caseId = 0;

  beforeEach(() => {
    caseId += 1;
    const space = createSpace(testDb, { tenantId: "default-tenant", name: `doc-space-${caseId}` });
    spaceId = space.id;
  });

  it("GET returns 400 without spaceId", async () => {
    const req = new Request("http://localhost/api/document-directory", {
      method: "GET",
      headers: { authorization: "Bearer k" },
    });
    const res = await GET(req as never);
    expect(res.status).toBe(400);
  });

  it("POST creates directory entry", async () => {
    const req = new Request("http://localhost/api/document-directory", {
      method: "POST",
      headers: { authorization: "Bearer k", "Content-Type": "application/json" },
      body: JSON.stringify({ spaceId, name: "Runbook", purpose: "Ops procedures" }),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entry.name).toBe("Runbook");
    expect(body.entry.version).toBe(1);
  });

  it("GET lists entries after create", async () => {
    await POST(
      new Request("http://localhost/api/document-directory", {
        method: "POST",
        headers: { authorization: "Bearer k", "Content-Type": "application/json" },
        body: JSON.stringify({ spaceId, name: "FAQ" }),
      }) as never
    );
    const req = new Request(`http://localhost/api/document-directory?spaceId=${spaceId}`, {
      method: "GET",
      headers: { authorization: "Bearer k" },
    });
    const res = await GET(req as never);
    const body = await res.json();
    expect(body.entries.length).toBe(1);
    expect(body.entries[0].name).toBe("FAQ");
  });
});
