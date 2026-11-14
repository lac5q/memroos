// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const TMP = path.join(os.tmpdir(), `audit-knowledge-b32-${randomUUID()}`);
const TEST_AGENT_KEY = `ak_test_${randomUUID().replace(/-/g, "").slice(0, 24)}`;

async function loadRoute() {
  process.env.SQLITE_DB_PATH = path.join(TMP, "audit.db");
  process.env.MEMROOS_AGENT_API_KEY = TEST_AGENT_KEY;
  vi.resetModules();
  const route = await import("../route");
  const dbModule = await import("@/lib/db");
  dbModule.getDb();
  return route;
}

beforeEach(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
  delete process.env.MEMROOS_AUDIT_ALLOW_REMOTE;
});

afterEach(async () => {
  try {
    const { closeDb } = await import("@/lib/db");
    closeDb();
  } catch {
    /* ignore */
  }
  delete process.env.SQLITE_DB_PATH;
  delete process.env.MEMROOS_AGENT_API_KEY;
  fs.rmSync(TMP, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("POST /api/audit/knowledge batch32", () => {
  it("treats unparseable request URLs as non-local (line 90)", async () => {
    const { POST } = await loadRoute();
    const req = new Request("http://localhost/api/audit/knowledge", {
      method: "POST",
      headers: {
        authorization: `Bearer ${TEST_AGENT_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        tenant_id: "default-tenant",
        agent_id: "agent-b32",
        operation: "read",
        path: "vault/test.md",
        op_hash: "sha256:abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
      }),
    });
    Object.defineProperty(req, "url", { configurable: true, value: "http://%zz/api/audit/knowledge" });
    const res = await POST(req as NextRequest);
    expect(res.status).toBe(404);
  });

  it("returns 500 when audit write fails (lines 222-223)", async () => {
    vi.doMock("@/lib/audit/write", () => ({
      writeAuditEntry: () => {
        throw new Error("append-only trigger blocked");
      },
    }));
    const { POST } = await loadRoute();
    const res = await POST(
      new NextRequest("http://localhost/api/audit/knowledge", {
        method: "POST",
        headers: {
          authorization: `Bearer ${TEST_AGENT_KEY}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          tenant_id: "default-tenant",
          agent_id: "agent-b32",
          operation: "write",
          path: "shared/b32.md",
          op_hash: "sha256:abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
        }),
      }),
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("audit write failed");
    expect(body.detail).toMatch(/append-only/);
  });
});
