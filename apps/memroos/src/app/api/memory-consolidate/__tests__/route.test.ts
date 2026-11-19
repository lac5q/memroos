// @vitest-environment node
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initSchema } from "@/lib/db-schema";

const testDb = new Database(":memory:");
initSchema(testDb);

const authenticateUser = vi.hoisted(() => vi.fn());
const runConsolidation = vi.hoisted(() =>
  vi.fn(async () => ({ status: "completed" as const, merged: 1 }))
);

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("@/lib/auth/session", () => ({
  authenticateUser: (...args: unknown[]) => authenticateUser(...args),
}));

vi.mock("@/lib/memory-consolidation", () => ({
  runConsolidation: (...args: unknown[]) => runConsolidation(...args),
}));

const { POST } = await import("../route");

describe("POST /api/memory-consolidate", () => {
  beforeEach(() => {
    authenticateUser.mockReset();
    runConsolidation.mockClear();
  });

  it("returns 401 without session", async () => {
    authenticateUser.mockResolvedValueOnce(null);
    const res = await POST(new Request("http://localhost/api/memory-consolidate", { method: "POST" }) as never);
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-operator role", async () => {
    authenticateUser.mockResolvedValueOnce({
      userId: "u1",
      role: "reviewer",
      email: "reviewer@example.com",
      displayName: "Reviewer",
      tenantId: "default-tenant",
    });
    const res = await POST(new Request("http://localhost/api/memory-consolidate", { method: "POST" }) as never);
    expect(res.status).toBe(403);
  });

  it("runs consolidation for operator session", async () => {
    authenticateUser.mockResolvedValueOnce({
      userId: "op1",
      role: "operator",
      email: "op@example.com",
      displayName: "Op",
      tenantId: "default-tenant",
    });
    const res = await POST(new Request("http://localhost/api/memory-consolidate", { method: "POST" }) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.run.status).toBe("completed");
  });

  it("returns 500 when consolidation throws", async () => {
    authenticateUser.mockResolvedValueOnce({
      userId: "op1",
      role: "admin",
      email: "admin@example.com",
      displayName: "Admin",
      tenantId: "default-tenant",
    });
    runConsolidation.mockRejectedValueOnce(new Error("boom"));
    const res = await POST(new Request("http://localhost/api/memory-consolidate", { method: "POST" }) as never);
    expect(res.status).toBe(500);
  });
});
