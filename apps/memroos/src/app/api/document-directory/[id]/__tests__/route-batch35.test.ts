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

describe("/api/document-directory/[id] batch35", () => {
  let entryId: number;

  beforeEach(() => {
    mockAuthenticate.mockReturnValue({ id: `agent-${randomUUID().slice(0, 8)}` });
    const space = createSpace(testDb, {
      tenantId: "default-tenant",
      name: `doc-b35-${randomUUID().slice(0, 6)}`,
    });
    entryId = createDocumentDirectoryEntry(testDb, {
      spaceId: space.id,
      name: `Entry ${randomUUID().slice(0, 4)}`,
      actorId: "agent-b35",
    }).id;
  });

  it("PATCH authenticates via body.agent hint (fn 12)", async () => {
    mockAuthenticate.mockImplementation((_headers: Headers, hint?: string) =>
      hint === "hint-agent-b35" ? { id: "hint-agent-b35" } : null,
    );
    const { PATCH } = await import("../route");
    const res = await PATCH(
      new Request(`${LOOPBACK}/api/document-directory/${entryId}`, {
        method: "PATCH",
        headers: { authorization: "Bearer k", "Content-Type": "application/json" },
        body: JSON.stringify({ agent: "hint-agent-b35", expectedVersion: 1, name: "Renamed B35" }),
      }) as never,
      { params: Promise.resolve({ id: String(entryId) }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entry.name).toBe("Renamed B35");
  });

  it("DELETE tolerates invalid JSON body via catch (fn 45)", async () => {
    const { DELETE } = await import("../route");
    const res = await DELETE(
      new Request(`${LOOPBACK}/api/document-directory/${entryId}`, {
        method: "DELETE",
        headers: { authorization: "Bearer k", "Content-Type": "application/json" },
        body: "not-json",
      }) as never,
      { params: Promise.resolve({ id: String(entryId) }) },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/expectedVersion/i);
  });
});
