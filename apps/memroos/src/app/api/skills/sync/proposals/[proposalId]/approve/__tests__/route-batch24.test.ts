// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TMP_ROOT = path.join(os.tmpdir(), `sync-approve-b24-${crypto.randomUUID()}`);
const signingKey = path.join(process.cwd(), "data", "skill-signing-key.json");
const LOOPBACK = "http://localhost";

beforeEach(() => {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  process.env.MEMROOS_ROOT = TMP_ROOT;
  process.env.SQLITE_DB_PATH = path.join(TMP_ROOT, `db-${crypto.randomUUID()}.db`);
  process.env.MEMROOS_OPERATOR_API_KEY = "right-key";
  vi.resetModules();
});

afterEach(async () => {
  delete process.env.MEMROOS_ROOT;
  delete process.env.SQLITE_DB_PATH;
  delete process.env.MEMROOS_OPERATOR_API_KEY;
  if (fs.existsSync(signingKey)) fs.unlinkSync(signingKey);
  try {
    const dbModule = await import("@/lib/db");
    dbModule.closeDb();
  } catch {
    /* ignore */
  }
  vi.resetModules();
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
});

describe("POST /api/skills/sync/proposals/:proposalId/approve batch24", () => {
  it("rejects missing proposalId and broken JSON bodies", async () => {
    const { initSchema } = await import("@/lib/db-schema");
    const { getDb } = await import("@/lib/db");
    initSchema(getDb());

    const { POST } = await import("../route");
    const missingId = await POST(
      new Request(`${LOOPBACK}/api/skills/sync/proposals/x/approve`, {
        method: "POST",
        headers: { authorization: "Bearer right-key", "content-type": "application/json" },
        body: JSON.stringify({ operator: "ops" }),
      }),
      { params: Promise.resolve({ proposalId: "" }) },
    );
    expect(missingId.status).toBe(400);

    const brokenJson = await POST(
      new Request(`${LOOPBACK}/api/skills/sync/proposals/prop-1/approve`, {
        method: "POST",
        headers: { authorization: "Bearer right-key", "content-type": "application/json" },
        body: "{",
      }),
      { params: Promise.resolve({ proposalId: "prop-1" }) },
    );
    expect(brokenJson.status).toBe(400);
    expect(await brokenJson.json()).toMatchObject({ error: "operator is required (string)" });
  });
});
