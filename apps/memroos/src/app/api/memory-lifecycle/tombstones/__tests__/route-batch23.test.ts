// @vitest-environment node
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initSchema } from "@/lib/db-schema";

const testDb = new Database(":memory:");
initSchema(testDb);

const authorizeRegistryWrite = vi.hoisted(() => vi.fn(() => true));

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("@/lib/operator-auth", () => ({
  authorizeRegistryWrite: (...args: unknown[]) => authorizeRegistryWrite(...args),
  registryWriteUnauthorizedResponse: () => Response.json({ ok: false, error: "forbidden" }, { status: 403 }),
}));

const LOOPBACK = "http://localhost";

describe("/api/memory-lifecycle/tombstones batch23", () => {
  beforeEach(() => {
    authorizeRegistryWrite.mockReturnValue(true);
  });

  it("POST rejects unsupported actions and missing required fields", async () => {
    const { POST } = await import("../route");
    const unsupported = await POST(
      new Request(`${LOOPBACK}/api/memory-lifecycle/tombstones`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "purge" }),
      })
    );
    expect(unsupported.status).toBe(400);
    expect(await unsupported.json()).toMatchObject({ error: expect.stringContaining("unsupported action") });

    const missingSubject = await POST(
      new Request(`${LOOPBACK}/api/memory-lifecycle/tombstones`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "write", erasureId: "e1" }),
      })
    );
    expect(missingSubject.status).toBe(400);
    expect(await missingSubject.json()).toMatchObject({ error: expect.stringContaining("subjectHash") });
  });

  it("GET requires subjectHash and returns 400 on list failures", async () => {
    const { GET } = await import("../route");
    const missing = await GET(new Request(`${LOOPBACK}/api/memory-lifecycle/tombstones`));
    expect(missing.status).toBe(400);

    vi.spyOn(testDb, "prepare").mockImplementationOnce(() => {
      throw new Error("tombstone list failed batch23");
    });
    const res = await GET(new Request(`${LOOPBACK}/api/memory-lifecycle/tombstones?subjectHash=abc`));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "tombstone list failed batch23" });
  });
});
