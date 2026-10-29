// @vitest-environment node
import { mkdtempSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";

const testDb = new Database(":memory:");
initSchema(testDb);

const mockAuthenticateUser = vi.fn();
const mockAuthorizeRegistryWrite = vi.fn();

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("@/lib/auth/session", () => ({
  authenticateUser: (...args: unknown[]) => mockAuthenticateUser(...args),
}));

vi.mock("@/lib/auth/middleware-roles", () => ({
  requireRole: () => null,
}));

vi.mock("@/lib/operator-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/operator-auth")>();
  return {
    ...actual,
    authorizeRegistryWrite: (...args: unknown[]) => mockAuthorizeRegistryWrite(...args),
  };
});

vi.mock("@/lib/knowledge-collections", () => ({
  loadCollections: vi.fn(() => []),
  collectCollectionFiles: vi.fn(async () => []),
}));

const LOOPBACK = "http://localhost";

function asReq(url: string, init?: RequestInit): NextRequest {
  return new Request(url, init) as unknown as NextRequest;
}

beforeEach(() => {
  mockAuthenticateUser.mockReset();
  mockAuthorizeRegistryWrite.mockReset();
  mockAuthenticateUser.mockResolvedValue({
    userId: "op-1",
    role: "operator",
    email: "op@example.com",
    displayName: "Operator",
    tenantId: "default-tenant",
  });
  mockAuthorizeRegistryWrite.mockReturnValue(true);
  vi.resetModules();
});

describe("long-tail batch19b easy routes — skills sync and import", () => {
  it("POST /api/skills/sync/check returns scan envelope", async () => {
    const root = mkdtempSync(path.join(tmpdir(), `sync-check-b19b-${randomUUID().slice(0, 6)}-`));
    const roots = {
      claude: path.join(root, "claude"),
      codex: path.join(root, "codex"),
      hermes: path.join(root, "hermes"),
      opencode: path.join(root, "opencode"),
    };
    const { POST } = await import("../skills/sync/check/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/skills/sync/check`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ roots, proposed_by: "batch19b" }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("POST /api/skills/import rejects non-object JSON", async () => {
    const { POST } = await import("../skills/import/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/skills/import`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "[]",
      }) as unknown as NextRequest,
    );
    expect(res.status).toBe(400);
  });

  it("POST /api/skills/sync/proposals/[proposalId]/reject requires reason", async () => {
    const { POST } = await import("../skills/sync/proposals/[proposalId]/reject/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/skills/sync/proposals/${randomUUID()}/reject`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }) as unknown as NextRequest,
      { params: Promise.resolve({ proposalId: randomUUID() }) } as never,
    );
    expect(res.status).toBe(400);
  });
});

describe("long-tail batch19b easy routes — agent context and checkpoints", () => {
  it("GET /api/agent-checkpoints requires runId", async () => {
    const { GET } = await import("../agent-checkpoints/route");
    const res = await GET(asReq(`${LOOPBACK}/api/agent-checkpoints?limit=3`));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toMatch(/runId/i);
  });

  it("GET /api/agent-memory/traces requires runId", async () => {
    const { GET } = await import("../agent-memory/traces/route");
    const res = await GET(asReq(`${LOOPBACK}/api/agent-memory/traces?limit=2`));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toMatch(/runId/i);
  });

  it("GET /api/library/freshness returns collection freshness envelope", async () => {
    const { GET } = await import("../library/freshness/route");
    const res = await GET(asReq(`${LOOPBACK}/api/library/freshness`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.collections)).toBe(true);
    expect(body.qmd).toBeDefined();
  });
});
