// @vitest-environment node
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { initSchema } from "@/lib/db-schema";

const testDb = new Database(":memory:");
initSchema(testDb);

const authenticateUser = vi.hoisted(() => vi.fn());
const checkSlaBreaches = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("@/lib/auth/session", () => ({
  authenticateUser: (...args: unknown[]) => authenticateUser(...args),
}));

vi.mock("@/lib/audit/sla", () => ({
  checkSlaBreaches: (...args: unknown[]) => checkSlaBreaches(...args),
}));

const reviewerSession = {
  userId: "rev-b32",
  role: "reviewer" as const,
  email: "rev@example.com",
  displayName: "Rev",
  tenantId: "default-tenant",
};

describe("GET /api/escalations batch32", () => {
  beforeEach(() => {
    authenticateUser.mockReset();
    checkSlaBreaches.mockReset();
    authenticateUser.mockResolvedValue(reviewerSession);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("logs and continues when SLA check throws (line 43)", async () => {
    checkSlaBreaches.mockImplementation(() => {
      throw new Error("sla-check-failed");
    });
    const { GET } = await import("../route");
    const res = await GET(new NextRequest("http://localhost/api/escalations?status=open"));
    expect(res.status).toBe(200);
    expect(console.error).toHaveBeenCalledWith(
      "[escalations] SLA breach check failed:",
      expect.any(Error),
    );
    const body = await res.json();
    expect(body.escalations).toBeDefined();
  });
});
