// @vitest-environment node
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initSchema } from "@/lib/db-schema";

const testDb = new Database(":memory:");
initSchema(testDb);

const mockAuthorizeRegistryWrite = vi.fn();

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("@/lib/operator-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/operator-auth")>();
  return {
    ...actual,
    authorizeRegistryWrite: (...args: unknown[]) => mockAuthorizeRegistryWrite(...args),
  };
});

const LOOPBACK = "http://localhost";

function jsonPost(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("batch14c — memory-lifecycle API routes", () => {
  beforeEach(() => {
    mockAuthorizeRegistryWrite.mockReset();
    mockAuthorizeRegistryWrite.mockReturnValue(true);
    vi.resetModules();
    vi.doUnmock("@/lib/memory/retention-expiry");
    vi.doUnmock("@/lib/memory/consolidation");
    vi.doUnmock("@/lib/memory/dsar");
    vi.doUnmock("@/lib/memory/graph-catchup");
  });

  it("POST /api/memory-lifecycle/expiry returns 400 when runKey missing", async () => {
    const { POST } = await import("../memory-lifecycle/expiry/route");
    const res = await POST(jsonPost(`${LOOPBACK}/api/memory-lifecycle/expiry`, { scope: {} }));
    expect(res.status).toBe(400);
  });

  it("POST /api/memory-lifecycle/expiry accepts minimal valid body", async () => {
    const { POST } = await import("../memory-lifecycle/expiry/route");
    const res = await POST(
      jsonPost(`${LOOPBACK}/api/memory-lifecycle/expiry`, {
        runKey: `run-${Date.now()}`,
        scope: {},
      })
    );
    expect([200, 409]).toContain(res.status);
  });

  it("POST /api/memory-lifecycle/legal-holds rejects unknown action", async () => {
    const { POST } = await import("../memory-lifecycle/legal-holds/route");
    const res = await POST(
      jsonPost(`${LOOPBACK}/api/memory-lifecycle/legal-holds`, { action: "noop" })
    );
    expect(res.status).toBe(400);
  });

  it("POST /api/memory-lifecycle/legal-holds create requires reasonCode", async () => {
    const { POST } = await import("../memory-lifecycle/legal-holds/route");
    const res = await POST(
      jsonPost(`${LOOPBACK}/api/memory-lifecycle/legal-holds`, {
        action: "create",
        scope: {},
        actorId: "op",
      })
    );
    expect(res.status).toBe(400);
  });

  it("GET /api/memory-lifecycle/legal-holds lists holds for tenant", async () => {
    const { GET } = await import("../memory-lifecycle/legal-holds/route");
    const res = await GET(new Request(`${LOOPBACK}/api/memory-lifecycle/legal-holds?tenantId=default-tenant`));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("POST /api/memory-lifecycle/retention returns 400 on validation error", async () => {
    const { POST } = await import("../memory-lifecycle/retention/route");
    const res = await POST(jsonPost(`${LOOPBACK}/api/memory-lifecycle/retention`, {}));
    expect(res.status).toBe(400);
  });

  it("POST /api/memory-lifecycle/vault returns 400 when actorId missing", async () => {
    const { POST } = await import("../memory-lifecycle/vault/route");
    const res = await POST(jsonPost(`${LOOPBACK}/api/memory-lifecycle/vault`, { action: "reconcile" }));
    expect(res.status).toBe(400);
  });

  it("POST /api/memory-lifecycle/consolidation returns 400 when run throws", async () => {
    vi.doMock("@/lib/memory/consolidation", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/lib/memory/consolidation")>();
      return {
        ...actual,
        runConsolidationCycle: vi.fn(() => {
          throw new Error("consolidation failed");
        }),
      };
    });
    const { POST } = await import("../memory-lifecycle/consolidation/route");
    const res = await POST(
      jsonPost(`${LOOPBACK}/api/memory-lifecycle/consolidation`, {
        runKey: "c1",
        scope: {},
        actorId: "op",
        sources: [
          {
            canonicalId: "c1",
            recordType: "memory",
            recordId: "r1",
            contentHash: "h1",
            ontologyType: "fact",
            tier: "hot",
            classification: {},
          },
        ],
      })
    );
    expect(res.status).toBe(400);
  });

  it("POST /api/memory-lifecycle/dsar returns 400 when action missing", async () => {
    const { POST } = await import("../memory-lifecycle/dsar/route");
    const res = await POST(jsonPost(`${LOOPBACK}/api/memory-lifecycle/dsar`, {}));
    expect(res.status).toBe(400);
  });

  it("POST /api/memory-lifecycle/graph-catchup returns 400 on runner failure", async () => {
    vi.doMock("@/lib/memory/graph-catchup", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/lib/memory/graph-catchup")>();
      return {
        ...actual,
        runGraphCatchup: vi.fn(async () => {
          throw new Error("graph catchup failed");
        }),
      };
    });
    const { POST } = await import("../memory-lifecycle/graph-catchup/route");
    const res = await POST(
      jsonPost(`${LOOPBACK}/api/memory-lifecycle/graph-catchup`, { force: true })
    );
    expect(res.status).toBe(400);
  });

  it("POST /api/memory-lifecycle/legal-holds release requires holdId", async () => {
    const { POST } = await import("../memory-lifecycle/legal-holds/route");
    const res = await POST(
      jsonPost(`${LOOPBACK}/api/memory-lifecycle/legal-holds`, {
        action: "release",
        actorId: "op",
      })
    );
    expect(res.status).toBe(400);
  });

  it("GET /api/memory-lifecycle/audit verifies chain when authorized", async () => {
    const { GET } = await import("../memory-lifecycle/audit/route");
    const res = await GET(new Request(`${LOOPBACK}/api/memory-lifecycle/audit`));
    expect(res.status).toBe(200);
  });
});
