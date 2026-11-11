// @vitest-environment node
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initSchema } from "@/lib/db-schema";
import { createSpace } from "@/lib/space";
import { createDocumentDirectoryEntry } from "@/lib/write-rules";

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

describe("/api/document-directory/[id] batch33", () => {
  let entryId: number;

  beforeEach(() => {
    mockAuthenticate.mockReturnValue({ id: `agent-${randomUUID().slice(0, 8)}` });
    const space = createSpace(testDb, {
      tenantId: "default-tenant",
      name: `doc-b33-${randomUUID().slice(0, 6)}`,
    });
    entryId = createDocumentDirectoryEntry(testDb, {
      spaceId: space.id,
      name: `Entry ${randomUUID().slice(0, 4)}`,
      actorId: "agent-b33",
    }).id;
  });

  it("PATCH returns 401 without agent auth (L12)", async () => {
    mockAuthenticate.mockReturnValueOnce(null);
    const { PATCH } = await import("../route");
    const res = await PATCH(
      new Request(`${LOOPBACK}/api/document-directory/${entryId}`, {
        method: "PATCH",
        headers: { authorization: "Bearer k", "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: 1, name: "Renamed" }),
      }) as never,
      { params: Promise.resolve({ id: String(entryId) }) },
    );
    expect(res.status).toBe(401);
  });

  it("DELETE parses agentId hint from JSON body (L45)", async () => {
    const { DELETE } = await import("../route");
    const res = await DELETE(
      new Request(`${LOOPBACK}/api/document-directory/${entryId}`, {
        method: "DELETE",
        headers: { authorization: "Bearer k", "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: "agent-b33", expectedVersion: 1 }),
      }) as never,
      { params: Promise.resolve({ id: String(entryId) }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});
