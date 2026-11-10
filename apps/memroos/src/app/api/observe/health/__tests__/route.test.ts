// @vitest-environment node
import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";

const testDb = new Database(":memory:");
initSchema(testDb);

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

const { GET } = await import("../route");

describe("GET /api/observe/health", () => {
  it("returns harness catalog and health rows", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.catalog)).toBe(true);
    expect(Array.isArray(body.harnesses)).toBe(true);
    expect(body.depthDefault).toBeTruthy();
  });
});
