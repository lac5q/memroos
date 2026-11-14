// @vitest-environment node
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { initSchema } from "@/lib/db-schema";

const testDb = new Database(":memory:");
initSchema(testDb);

const authenticateUser = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("@/lib/auth/session", () => ({
  authenticateUser: (...args: unknown[]) => authenticateUser(...args),
}));

const operatorSession = {
  userId: "op-b32",
  role: "operator" as const,
  email: "op@example.com",
  displayName: "Op",
  tenantId: "default-tenant",
};

describe("POST /api/escalations/:id/resolve batch32", () => {
  beforeEach(() => {
    authenticateUser.mockReset();
    authenticateUser.mockResolvedValue(operatorSession);
  });

  it("returns 400 when id param is empty (line 29)", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      new NextRequest("http://localhost/api/escalations//resolve", { method: "POST" }),
      { params: Promise.resolve({ id: "" }) },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/escalation id is required/i);
  });
});
