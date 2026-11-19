// @vitest-environment node
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initSchema } from "@/lib/db-schema";
import { createSpace } from "@/lib/space";
import { createDocumentDirectoryEntry } from "@/lib/write-rules";

const testDb = new Database(":memory:");
initSchema(testDb);

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("@/lib/agent-registry", () => ({
  authenticateAgentHeaders: vi.fn(() => ({ id: "agent-1" })),
}));

const { PATCH, DELETE } = await import("../route");

describe("/api/document-directory/[id]", () => {
  let entryId: number;
  let caseId = 0;

  beforeEach(() => {
    caseId += 1;
    const space = createSpace(testDb, { tenantId: "default-tenant", name: `dir-space-${caseId}` });
    const entry = createDocumentDirectoryEntry(testDb, {
      spaceId: space.id,
      name: "Original",
      actorId: "agent-1",
    });
    entryId = entry.id;
  });

  it("PATCH updates entry name", async () => {
    const req = new Request(`http://localhost/api/document-directory/${entryId}`, {
      method: "PATCH",
      headers: { authorization: "Bearer k", "Content-Type": "application/json" },
      body: JSON.stringify({ expectedVersion: 1, name: "Renamed" }),
    });
    const res = await PATCH(req as never, { params: Promise.resolve({ id: String(entryId) }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entry.name).toBe("Renamed");
    expect(body.entry.version).toBe(2);
  });

  it("DELETE removes entry", async () => {
    const req = new Request(`http://localhost/api/document-directory/${entryId}`, {
      method: "DELETE",
      headers: { authorization: "Bearer k", "Content-Type": "application/json" },
      body: JSON.stringify({ expectedVersion: 1 }),
    });
    const res = await DELETE(req as never, { params: Promise.resolve({ id: String(entryId) }) });
    expect(res.status).toBe(200);
    const row = testDb.prepare("SELECT id FROM document_directory WHERE id = ?").get(entryId);
    expect(row).toBeUndefined();
  });
});
