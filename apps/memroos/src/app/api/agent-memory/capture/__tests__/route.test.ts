// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initSchema } from "@/lib/db-schema";

const vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "capture-route-vault-"));
vi.stubEnv("MEMROOS_VAULT_ROOT", vaultRoot);

const authorizeRegistryWrite = vi.hoisted(() => vi.fn(() => true));

vi.mock("@/lib/operator-auth", () => ({
  authorizeRegistryWrite: (...args: unknown[]) => authorizeRegistryWrite(...args),
  registryWriteUnauthorizedResponse: () =>
    Response.json({ ok: false, error: "Unauthorized" }, { status: 401 }),
}));

const testDb = new Database(":memory:");
initSchema(testDb);

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

const { POST } = await import("../route");

describe("POST /api/agent-memory/capture", () => {
  beforeEach(() => {
    authorizeRegistryWrite.mockReturnValue(true);
    testDb.exec("DELETE FROM agent_session_captures");
    testDb.exec("DELETE FROM agent_memory_candidates");
    testDb.exec("DELETE FROM raw_artifacts");
  });

  it("returns 401 when registry write is unauthorized", async () => {
    authorizeRegistryWrite.mockReturnValueOnce(false);
    const res = await POST(
      new Request("http://localhost/api/agent-memory/capture", {
        method: "POST",
        body: JSON.stringify({ sessionId: "s", sourceAgentId: "a", runtime: "codex" }),
      })
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid JSON", async () => {
    const res = await POST(
      new Request("http://localhost/api/agent-memory/capture", { method: "POST", body: "not-json" })
    );
    expect(res.status).toBe(400);
  });

  it("captures a coding agent session when authorized", async () => {
    const res = await POST(
      new Request("http://localhost/api/agent-memory/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceAgentId: "codex",
          runtime: "codex",
          sessionId: "capture-route-1",
          summary: "Route coverage",
        }),
      })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.capture.sessionId).toBe("capture-route-1");
  });
});
