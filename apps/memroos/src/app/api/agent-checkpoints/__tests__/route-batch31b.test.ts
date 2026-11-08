// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/operator-auth", () => ({
  authorizeRegistryWrite: () => true,
  registryWriteUnauthorizedResponse: () => Response.json({ ok: false }, { status: 401 }),
}));

import { createAgentCheckpoint } from "@/lib/agent-checkpoints";

const TMP_ROOT = path.join(os.tmpdir(), `agent-checkpoints-route-b31b-${randomUUID()}`);

beforeEach(async () => {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  process.env.SQLITE_DB_PATH = path.join(TMP_ROOT, `${randomUUID()}.db`);
  const { closeDb, getDb } = await import("@/lib/db");
  closeDb();
  const db = getDb();
  const runId = `run-${randomUUID().slice(0, 8)}`;
  createAgentCheckpoint(db, {
    runId,
    ownerAgentId: "agent-b31b",
    objective: "Route resume batch31b",
    nextSafeAction: "continue",
  });
  process.env.AGENT_CHECKPOINT_TEST_RUN_ID = runId;
});

afterEach(async () => {
  const { closeDb } = await import("@/lib/db");
  closeDb();
  delete process.env.SQLITE_DB_PATH;
  delete process.env.AGENT_CHECKPOINT_TEST_RUN_ID;
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
});

describe("agent-checkpoints route batch31b", () => {
  it("GET returns 404 when run id is unknown (lines 56-59)", async () => {
    const { GET } = await import("../route");
    const res = await GET(
      new Request(
        `http://localhost/api/agent-checkpoints?tenantId=default-tenant&runId=missing-${randomUUID()}`,
      ),
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.status).toBe("not_found");
  });

  it("GET resumes the latest checkpoint for a known run", async () => {
    const { GET } = await import("../route");
    const runId = process.env.AGENT_CHECKPOINT_TEST_RUN_ID!;
    const res = await GET(
      new Request(`http://localhost/api/agent-checkpoints?tenantId=default-tenant&runId=${runId}`),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.checkpoint.runId).toBe(runId);
  });
});
