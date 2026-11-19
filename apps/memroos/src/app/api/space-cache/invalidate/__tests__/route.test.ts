// @vitest-environment node
import crypto from "crypto";
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

const { POST } = await import("../route");
const { authenticateAgentHeaders } = await import("@/lib/agent-registry");

describe("POST /api/space-cache/invalidate", () => {
  let spaceId = "";

  beforeEach(() => {
    vi.mocked(authenticateAgentHeaders).mockReturnValue({ id: "agent-1" } as never);
    spaceId = createSpace(testDb, {
      tenantId: "default-tenant",
      name: `inv-${crypto.randomUUID()}`,
    }).id;
  });

  it("returns 401 without auth", async () => {
    vi.mocked(authenticateAgentHeaders).mockReturnValueOnce(null);
    const res = await POST(
      new Request("http://localhost/api/space-cache/invalidate", {
        method: "POST",
        body: JSON.stringify({ spaceId }),
      }) as never
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 when spaceId is missing", async () => {
    const res = await POST(
      new Request("http://localhost/api/space-cache/invalidate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }) as never
    );
    expect(res.status).toBe(400);
  });

  it("invalidates a single resource when resourceId is provided", async () => {
    const res = await POST(
      new Request("http://localhost/api/space-cache/invalidate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ space_id: spaceId, resourceId: "doc-1", agentId: "agent-1" }),
      }) as never
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("invalidates entire space cache", async () => {
    const res = await POST(
      new Request("http://localhost/api/space-cache/invalidate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spaceId, reason: "refresh" }),
      }) as never
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});
