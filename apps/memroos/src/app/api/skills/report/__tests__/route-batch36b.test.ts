// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

import { initSchema } from "@/lib/db-schema";

const testDb = new Database(":memory:");
initSchema(testDb);

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

const mockAuth = vi.fn();

vi.mock("@/lib/agent-registry", () => ({
  authenticateAgentHeaders: (...args: unknown[]) => mockAuth(...args),
}));

beforeEach(() => {
  mockAuth.mockReturnValue({ id: "agent-b36b", tenantId: "default-tenant" });
  vi.resetModules();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/skills/report batch36b", () => {
  it("json().catch treats invalid JSON as null body (153)", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      new Request("http://localhost/api/skills/report", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer test" },
        body: "{bad-json-b36b",
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/skillId and action are required/i);
  });

  it("uses agentId hint from malformed-but-parsed bodies when possible", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      new Request("http://localhost/api/skills/report", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId: `hint-${randomUUID().slice(0, 6)}` }),
      }),
    );
    expect(mockAuth).toHaveBeenCalled();
    expect(res.status).toBe(400);
  });
});
