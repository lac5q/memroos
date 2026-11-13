// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TMP_ROOT = path.join(os.tmpdir(), `skills-routes-b23-${crypto.randomUUID()}`);
const signingKey = path.join(process.cwd(), "data", "skill-signing-key.json");
const LOOPBACK = "http://localhost";

function makePost(url: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

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

async function initDb() {
  const { getDb } = await import("@/lib/db");
  const { initSchema } = await import("@/lib/db-schema");
  const db = getDb();
  initSchema(db);
  return db;
}

describe("skills routes batch23", () => {
  it("POST /api/skills/proposals/[id]/approve rejects empty id and non-object bodies", async () => {
    await initDb();
    const approveRoute = await import("../proposals/[id]/approve/route");
    const emptyId = await approveRoute.POST(
      makePost(`${LOOPBACK}/api/skills/proposals/x/approve`, { operator: "ops" }, {
        authorization: "Bearer right-key",
      }),
      { params: Promise.resolve({ id: "" }) }
    );
    expect(emptyId.status).toBe(400);

    const badBody = await approveRoute.POST(
      makePost(`${LOOPBACK}/api/skills/proposals/x/approve`, [1, 2], {
        authorization: "Bearer right-key",
      }),
      { params: Promise.resolve({ id: "prop-1" }) }
    );
    expect(badBody.status).toBe(400);
    expect(await badBody.json()).toMatchObject({ error: "Body must be an object" });
  });

  it("POST /api/skills/proposals/[id]/approve returns 500 on unexpected errors", async () => {
    vi.doMock("@/lib/skills/skill-sync-governance", async () => {
      const actual = await vi.importActual<typeof import("@/lib/skills/skill-sync-governance")>(
        "@/lib/skills/skill-sync-governance"
      );
      return {
        ...actual,
        approveImportProposal: () => {
          throw new Error("approve blew up batch23");
        },
      };
    });
    vi.resetModules();
    await initDb();
    const approveRoute = await import("../proposals/[id]/approve/route");
    const res = await approveRoute.POST(
      makePost(`${LOOPBACK}/api/skills/proposals/x/approve`, { operator: "ops" }, {
        authorization: "Bearer right-key",
      }),
      { params: Promise.resolve({ id: "prop-1" }) }
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("approve blew up") });
    vi.doUnmock("@/lib/skills/skill-sync-governance");
  });

  it("POST /api/skills/pins/by-id/[id]/rollback accepts broken JSON bodies and surfaces 500 failures", async () => {
    await initDb();
    const rbRoute = await import("../pins/by-id/[id]/rollback/route");
    const missingOperator = await rbRoute.POST(
      new Request(`${LOOPBACK}/api/skills/pins/1/rollback`, {
        method: "POST",
        headers: { authorization: "Bearer right-key", "content-type": "application/json" },
        body: "{",
      }),
      { params: Promise.resolve({ id: "1" }) }
    );
    expect(missingOperator.status).toBe(400);

    vi.doMock("@/lib/skills/skill-sync-governance", async () => {
      const actual = await vi.importActual<typeof import("@/lib/skills/skill-sync-governance")>(
        "@/lib/skills/skill-sync-governance"
      );
      return {
        ...actual,
        rollbackAgentVersionPin: () => {
          throw new Error("rollback blew up batch23");
        },
      };
    });
    vi.resetModules();
    await initDb();
    const rbRouteMocked = await import("../pins/by-id/[id]/rollback/route");
    const res = await rbRouteMocked.POST(
      makePost(`${LOOPBACK}/api/skills/pins/1/rollback`, { operator: "ops" }, {
        authorization: "Bearer right-key",
      }),
      { params: Promise.resolve({ id: "1" }) }
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("rollback blew up") });
    vi.doUnmock("@/lib/skills/skill-sync-governance");
  });

  it("POST /api/skills/quarantine/approve validates JSON and returns 500 on unexpected failures", async () => {
    await initDb();
    const approveRoute = await import("../quarantine/approve/route");
    const invalidJson = await approveRoute.POST(
      new Request(`${LOOPBACK}/api/skills/quarantine/approve`, {
        method: "POST",
        headers: { authorization: "Bearer right-key", "content-type": "application/json" },
        body: "{",
      })
    );
    expect(invalidJson.status).toBe(400);

    const notObject = await approveRoute.POST(
      makePost(`${LOOPBACK}/api/skills/quarantine/approve`, "nope", {
        authorization: "Bearer right-key",
      })
    );
    expect(notObject.status).toBe(400);

    vi.doMock("@/lib/skills/skill-quarantine", async () => {
      const actual = await vi.importActual<typeof import("@/lib/skills/skill-quarantine")>(
        "@/lib/skills/skill-quarantine"
      );
      return {
        ...actual,
        getQuarantineRecord: () => ({
          stage: "pending_approval",
          skill_id: 1,
          approval_status: "pending",
        }),
        approveQuarantine: () => {
          throw new Error("quarantine approve batch23");
        },
      };
    });
    vi.resetModules();
    await initDb();
    const approveMocked = await import("../quarantine/approve/route");
    const res = await approveMocked.POST(
      makePost(
        `${LOOPBACK}/api/skills/quarantine/approve`,
        { skill_id: 1, operator: "ops" },
        { authorization: "Bearer right-key" }
      )
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("quarantine approve") });
    vi.doUnmock("@/lib/skills/skill-quarantine");
  });

  it("POST /api/skills/sync/check returns 500 when checkSync throws a non-SkillSyncError", async () => {
    vi.doMock("@/lib/skills/skill-sync", async () => {
      const actual = await vi.importActual<typeof import("@/lib/skills/skill-sync")>("@/lib/skills/skill-sync");
      return {
        ...actual,
        checkSync: () => {
          throw new Error("sync check batch23");
        },
      };
    });
    vi.resetModules();
    await initDb();
    const route = await import("../sync/check/route");
    const roots = {
      claude: path.join(TMP_ROOT, "claude"),
      codex: path.join(TMP_ROOT, "codex"),
      hermes: path.join(TMP_ROOT, "hermes"),
      opencode: path.join(TMP_ROOT, "opencode"),
    };
    for (const dir of Object.values(roots)) fs.mkdirSync(dir, { recursive: true });
    const res = await route.POST(
      makePost(`${LOOPBACK}/api/skills/sync/check`, { roots }, { authorization: "Bearer right-key" })
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("sync check batch23") });
    vi.doUnmock("@/lib/skills/skill-sync");
  });
});
