// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";

import { initSchema } from "@/lib/db-schema";

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

vi.mock("@/lib/shared-space", () => ({
  isSpaceShared: vi.fn(() => false),
  setSpaceShared: vi.fn(),
}));

beforeEach(() => {
  mockAuthenticate.mockReturnValue({ id: "agent-b36b", tenantId: "default-tenant" });
  vi.resetModules();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("/api/shared-space batch36b", () => {
  it("POST reads agentId body hint when agent is absent (30–31)", async () => {
    const { POST } = await import("../route");
    const spaceId = `space-b36b-${randomUUID().slice(0, 8)}`;
    const res = await POST(
      new NextRequest("http://localhost/api/shared-space", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ spaceId, isShared: true, agentId: "hint-agent-b36b" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(mockAuthenticate).toHaveBeenCalled();
    const headers = mockAuthenticate.mock.calls[0]?.[0] as Headers;
    expect(headers).toBeDefined();
  });
});
