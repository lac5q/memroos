// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  generateKeyPair,
  hashSkillContent,
  publicKeyFingerprint,
  resolveOperatorKeyPath,
  signRawSkillBody,
  signSkill,
  writeOperatorKeyFile,
} from "@/lib/skills/skill-signing";

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

/** Persist a key for routes that call readOperatorKeyFile() with no repo override. */
function installEphemeralOperatorKey() {
  const { publicKey, privateKey } = generateKeyPair();
  const fingerprint = publicKeyFingerprint(publicKey);
  writeOperatorKeyFile({
    algorithm: "ed25519",
    public_key_pem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    private_key_pem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    public_key_fingerprint: fingerprint,
    generated_at: new Date().toISOString(),
  });
  return { publicKey, privateKey, fingerprint };
}

function removeOperatorKeyFile() {
  try {
    fs.unlinkSync(resolveOperatorKeyPath());
  } catch {
    /* absent is fine */
  }
}

function jsonPost(url: string, body: unknown, init: RequestInit = {}): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...(init.headers as Record<string, string>) },
    body: JSON.stringify(body),
    ...init,
  });
}

function insertSkillRow(
  overrides: {
    name?: string;
    source_harness?: string;
    raw_body?: string;
    content_hash?: string | null;
    signature?: string | null;
    dispatch_status?: string;
    completeness_pct?: number;
    lifecycle_state?: string;
  } = {},
): number {
  const rawBody = overrides.raw_body ?? "---\nname: batch17-skill\n---\nbody";
  const contentHash =
    overrides.content_hash === undefined
      ? hashSkillContent(rawBody)
      : overrides.content_hash;
  const result = testDb
    .prepare(
      `INSERT INTO skill_registry (
        name, description, owner, source_harness, risk_tier, dispatch_status,
        version, preconditions, allowed_tools, verification_checks, rollback_behavior,
        raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
        evidence_examples, content_hash, signature, signed_by, signed_at, trust_level,
        public_key_fingerprint, lifecycle_state
      ) VALUES (
        ?, 'desc', 'ops', ?, 'low', ?,
        '1.0.0', 'none', 'read', 'check', 'revert',
        ?, ?, '[]', 'operator', ?, 'evidence',
        ?, ?, NULL, NULL, 'unsigned', NULL, ?
      )`,
    )
    .run(
      overrides.name ?? `skill-${randomUUID().slice(0, 8)}`,
      overrides.source_harness ?? "claude",
      overrides.dispatch_status ?? "enabled",
      rawBody,
      overrides.completeness_pct ?? 100,
      new Date().toISOString(),
      contentHash,
      overrides.signature ?? null,
      overrides.lifecycle_state ?? "draft",
    );
  return Number(result.lastInsertRowid);
}

describe("long-tail batch17 — skills API routes", () => {
  beforeEach(() => {
    mockAuthorizeRegistryWrite.mockReset();
    mockAuthorizeRegistryWrite.mockImplementation((req: Request) => {
      try {
        return new URL(req.url).hostname === "localhost";
      } catch {
        return false;
      }
    });
    testDb.exec("DELETE FROM skill_version_pins");
    testDb.exec("DELETE FROM skill_import_proposals");
    testDb.exec("DELETE FROM skill_registry");
    testDb.exec("DELETE FROM registered_agents");
    vi.resetModules();
    delete process.env.MEMROOS_OPERATOR_API_KEY;
    removeOperatorKeyFile();
  });

  afterEach(() => {
    removeOperatorKeyFile();
    vi.restoreAllMocks();
  });

  it("POST /api/skills/verify rejects invalid JSON and non-object bodies", async () => {
    const { POST } = await import("../skills/verify/route");
    expect(
      (await POST(new Request(`${LOOPBACK}/api/skills/verify`, { method: "POST", body: "{" }))).status,
    ).toBe(400);
    expect(
      (
        await POST(
          jsonPost(`${LOOPBACK}/api/skills/verify`, null),
        )
      ).status,
    ).toBe(400);
  });

  it("POST /api/skills/verify loads registry rows scoped by source_harness", async () => {
    const body = "---\nname: harness-scoped\n---\n";
    const name = `harness-${randomUUID().slice(0, 8)}`;
    insertSkillRow({ name, source_harness: "claude", raw_body: body });
    insertSkillRow({ name, source_harness: "codex", raw_body: `${body}codex` });
    const keyPair = installEphemeralOperatorKey();
    const signature = signRawSkillBody(body + "codex", keyPair).signature;
    testDb
      .prepare(`UPDATE skill_registry SET signature = ? WHERE name = ? AND source_harness = 'codex'`)
      .run(signature, name);

    const { POST } = await import("../skills/verify/route");
    const res = await POST(
      jsonPost(`${LOOPBACK}/api/skills/verify`, {
        skill_name: name,
        source_harness: "codex",
      }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).verified).toBe(true);
  });

  it("POST /api/skills/verify reports malformed operator key files", async () => {
    const signing = await import("@/lib/skills/skill-signing");
    vi.spyOn(signing, "readOperatorKeyFile").mockReturnValueOnce({
      algorithm: "ed25519",
      public_key_pem: "not-valid-pem",
      private_key_pem: "ignored",
      public_key_fingerprint: "fp",
      generated_at: new Date().toISOString(),
    });
    const { POST } = await import("../skills/verify/route");
    const res = await POST(
      jsonPost(`${LOOPBACK}/api/skills/verify`, { skill_name: "missing-skill" }),
    );
    expect(res.status).toBe(500);
    expect((await res.json()).reason).toMatch(/malformed/i);
  });

  it("POST /api/skills/verify surfaces operator key load failures", async () => {
    const signing = await import("@/lib/skills/skill-signing");
    vi.spyOn(signing, "readOperatorKeyFile").mockImplementationOnce(() => {
      throw new Error("disk unreadable");
    });
    const { POST } = await import("../skills/verify/route");
    const res = await POST(
      jsonPost(`${LOOPBACK}/api/skills/verify`, { skill_name: "missing-skill" }),
    );
    expect(res.status).toBe(500);
    expect((await res.json()).reason).toMatch(/disk unreadable/i);
  });

  it("POST /api/skills/verify inline mode verifies signatures with supplied PEM", async () => {
    const keyPair = generateKeyPair();
    const publicPem = keyPair.publicKey.export({ type: "spki", format: "pem" }).toString();
    const content = "inline skill body";
    const contentHash = hashSkillContent(content);
    const signature = signSkill(keyPair.privateKey, contentHash);

    const { POST } = await import("../skills/verify/route");
    const res = await POST(
      jsonPost(`${LOOPBACK}/api/skills/verify`, {
        content_hash: contentHash,
        signature,
        public_key_pem: publicPem,
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.verified).toBe(true);
    expect(body.fingerprint).toBeTruthy();
  });

  it("POST /api/skills/sign rejects invalid JSON and non-object bodies", async () => {
    const { POST } = await import("../skills/sign/route");
    expect(
      (await POST(new Request(`${LOOPBACK}/api/skills/sign`, { method: "POST", body: "{" }))).status,
    ).toBe(400);
    expect((await POST(jsonPost(`${LOOPBACK}/api/skills/sign`, "string"))).status).toBe(400);
  });

  it("POST /api/skills/sign returns 500 when operator keypair load fails", async () => {
    const signing = await import("@/lib/skills/skill-signing");
    vi.spyOn(signing, "loadOrCreateOperatorKeyPair").mockImplementationOnce(() => {
      throw new Error("keypair unavailable");
    });
    const skillId = insertSkillRow();
    const nameRow = testDb
      .prepare(`SELECT name FROM skill_registry WHERE id = ?`)
      .get(skillId) as { name: string };
    const { POST } = await import("../skills/sign/route");
    const res = await POST(jsonPost(`${LOOPBACK}/api/skills/sign`, { skill_name: nameRow.name }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/keypair unavailable/i);
  });

  it("POST /api/skills/sign returns 500 when registry persistence transaction fails", async () => {
    const skillId = insertSkillRow();
    const nameRow = testDb
      .prepare(`SELECT name FROM skill_registry WHERE id = ?`)
      .get(skillId) as { name: string };
    const { getDb } = await import("@/lib/db");
    const db = getDb();
    vi.spyOn(db, "transaction").mockImplementationOnce(() => {
      return () => {
        throw new Error("txn failed");
      };
    });
    const { POST } = await import("../skills/sign/route");
    const res = await POST(jsonPost(`${LOOPBACK}/api/skills/sign`, { skill_name: nameRow.name }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/Database error/i);
  });

  it("POST /api/skills/pins validates JSON and required string fields", async () => {
    const { POST } = await import("../skills/pins/route");
    expect(
      (await POST(new Request(`${LOOPBACK}/api/skills/pins`, { method: "POST", body: "{" }))).status,
    ).toBe(400);
    expect((await POST(jsonPost(`${LOOPBACK}/api/skills/pins`, {}))).status).toBe(400);
    expect(
      (
        await POST(
          jsonPost(`${LOOPBACK}/api/skills/pins`, {
            agent_id: "a1",
            skill_name: "",
            current_version: "1",
            current_content_hash: "0".repeat(64),
            actor: "op",
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await POST(
          jsonPost(`${LOOPBACK}/api/skills/pins`, {
            agent_id: "a1",
            skill_name: "s1",
            current_version: "",
            current_content_hash: "0".repeat(64),
            actor: "op",
          }),
        )
      ).status,
    ).toBe(400);
  });

  it("POST /api/skills/pins returns 500 for unexpected governance failures", async () => {
    const governance = await import("@/lib/skills/skill-sync-governance");
    vi.spyOn(governance, "createOrUpdateAgentVersionPin").mockImplementationOnce(() => {
      throw new Error("unexpected pin failure");
    });
    const { POST } = await import("../skills/pins/route");
    const res = await POST(
      jsonPost(`${LOOPBACK}/api/skills/pins`, {
        agent_id: "agent-1",
        skill_name: "skill-1",
        current_version: "1.0.0",
        current_content_hash: "a".repeat(64),
        actor: "operator",
      }),
    );
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/unexpected pin failure/i);
  });

  it("POST /api/skills/pins/:agent/rollback validates body and surfaces unexpected errors", async () => {
    const { POST } = await import("../skills/pins/[agent]/rollback/route");
    expect(
      (
        await POST(
          new Request(`${LOOPBACK}/api/skills/pins/agent-1/rollback`, { method: "POST", body: "{" }),
          { params: Promise.resolve({ agent: "agent-1" }) },
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await POST(
          jsonPost(`${LOOPBACK}/api/skills/pins/agent-1/rollback`, null),
          { params: Promise.resolve({ agent: "agent-1" }) },
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await POST(
          jsonPost(`${LOOPBACK}/api/skills/pins/agent-1/rollback`, { operator: "op" }),
          { params: Promise.resolve({ agent: "agent-1" }) },
        )
      ).status,
    ).toBe(400);

    const governance = await import("@/lib/skills/skill-sync-governance");
    vi.spyOn(governance, "rollbackAgentVersionPinByAgent").mockImplementationOnce(() => {
      throw new Error("rollback exploded");
    });
    const res = await POST(
      jsonPost(`${LOOPBACK}/api/skills/pins/agent-1/rollback`, {
        skill_name: "skill-x",
        operator: "operator",
      }),
      { params: Promise.resolve({ agent: "agent-1" }) },
    );
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/rollback exploded/i);
  });

  it("POST /api/skills/lifecycle rejects invalid JSON and non-object bodies", async () => {
    const { POST } = await import("../skills/lifecycle/route");
    expect(
      (await POST(new Request(`${LOOPBACK}/api/skills/lifecycle`, { method: "POST", body: "{" }))).status,
    ).toBe(400);
    expect((await POST(jsonPost(`${LOOPBACK}/api/skills/lifecycle`, []))).status).toBe(400);
  });

  it("POST /api/skills/lifecycle returns 500 for unexpected transition failures", async () => {
    const lifecycle = await import("@/lib/skills/skill-lifecycle");
    vi.spyOn(lifecycle, "transitionLifecycleState").mockImplementationOnce(() => {
      throw new Error("lifecycle store offline");
    });
    const skillId = insertSkillRow({ lifecycle_state: "draft" });
    const { POST } = await import("../skills/lifecycle/route");
    const res = await POST(
      jsonPost(`${LOOPBACK}/api/skills/lifecycle`, {
        skill_id: skillId,
        to_state: "enabled",
        actor: "operator",
      }),
    );
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/lifecycle store offline/i);
  });

  it("GET /api/skills/proposals rejects invalid status filters", async () => {
    const { GET } = await import("../skills/proposals/route");
    const res = await GET(new Request(`${LOOPBACK}/api/skills/proposals?status=not-a-status`));
    expect(res.status).toBe(400);
  });

  it("POST /api/skills/proposals validates proposal payload fields", async () => {
    const { POST } = await import("../skills/proposals/route");
    expect(
      (await POST(new Request(`${LOOPBACK}/api/skills/proposals`, { method: "POST", body: "{" }))).status,
    ).toBe(400);
    expect(
      (
        await POST(
          jsonPost(`${LOOPBACK}/api/skills/proposals`, {
            source_harness: "claude",
            skill_name: "s",
            proposed_by: "",
            detected_content_hash: "0".repeat(64),
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await POST(
          jsonPost(`${LOOPBACK}/api/skills/proposals`, {
            source_harness: "claude",
            skill_name: "s",
            proposed_by: "operator",
            detected_content_body: 123,
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await POST(
          jsonPost(`${LOOPBACK}/api/skills/proposals`, {
            source_harness: "claude",
            skill_name: "s",
            proposed_by: "operator",
            diff_payload: "not-object",
          }),
        )
      ).status,
    ).toBe(400);
  });

  it("POST /api/skills/proposals returns 500 when detection throws unexpectedly", async () => {
    const governance = await import("@/lib/skills/skill-sync-governance");
    vi.spyOn(governance, "detectSkillChange").mockImplementationOnce(() => {
      throw new Error("detector crashed");
    });
    const { POST } = await import("../skills/proposals/route");
    const res = await POST(
      jsonPost(`${LOOPBACK}/api/skills/proposals`, {
        source_harness: "claude",
        skill_name: "skill-detect",
        proposed_by: "operator",
        detected_content_hash: createHash("sha256").update("body").digest("hex"),
      }),
    );
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/detector crashed/i);
  });

  it("POST /api/skills/proposals/:id/approve validates operator and handles failures", async () => {
    const { POST } = await import("../skills/proposals/[id]/approve/route");
    expect(
      (
        await POST(jsonPost(`${LOOPBACK}/api/skills/proposals/p1/approve`, {}), {
          params: Promise.resolve({ id: "p1" }),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await POST(
          new Request(`${LOOPBACK}/api/skills/proposals/p1/approve`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "not-json",
          }),
          { params: Promise.resolve({ id: "p1" }) },
        )
      ).status,
    ).toBe(400);

    const governance = await import("@/lib/skills/skill-sync-governance");
    vi.spyOn(governance, "approveImportProposal").mockImplementationOnce(() => {
      throw new Error("approve exploded");
    });
    const res = await POST(
      jsonPost(`${LOOPBACK}/api/skills/proposals/prop-1/approve`, { operator: "operator" }),
      { params: Promise.resolve({ id: "prop-1" }) },
    );
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/approve exploded/i);
  });

  it("POST /api/skills/sync/approve validates required fields and unexpected failures", async () => {
    const { POST } = await import("../skills/sync/approve/route");
    expect(
      (await POST(new Request(`${LOOPBACK}/api/skills/sync/approve`, { method: "POST", body: "{" }))).status,
    ).toBe(400);
    expect((await POST(jsonPost(`${LOOPBACK}/api/skills/sync/approve`, {}))).status).toBe(400);
    expect(
      (
        await POST(
          jsonPost(`${LOOPBACK}/api/skills/sync/approve`, {
            skill_name: "s",
            source_harness: "claude",
            operator: "",
          }),
        )
      ).status,
    ).toBe(400);

    const sync = await import("@/lib/skills/skill-sync");
    vi.spyOn(sync, "approveImportProposal").mockImplementationOnce(() => {
      throw new Error("sync approve exploded");
    });
    const res = await POST(
      jsonPost(`${LOOPBACK}/api/skills/sync/approve`, {
        skill_name: "skill-x",
        source_harness: "claude",
        operator: "operator",
      }),
    );
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/sync approve exploded/i);
  });

  it("POST /api/skills/sync/proposals/:proposalId/approve validates operator and handles failures", async () => {
    const { POST } = await import("../skills/sync/proposals/[proposalId]/approve/route");
    expect(
      (
        await POST(
          jsonPost(`${LOOPBACK}/api/skills/sync/proposals/prop-1/approve`, {}),
          { params: Promise.resolve({ proposalId: "prop-1" }) },
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await POST(
          new Request(`${LOOPBACK}/api/skills/sync/proposals/prop-1/approve`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "[]",
          }),
          { params: Promise.resolve({ proposalId: "prop-1" }) },
        )
      ).status,
    ).toBe(400);

    const skillSync = await import("@/lib/skills/skill-sync");
    vi.spyOn(skillSync, "approveSyncProposalById").mockImplementationOnce(() => {
      throw new Error("sync proposal approve exploded");
    });
    const res = await POST(
      jsonPost(`${LOOPBACK}/api/skills/sync/proposals/prop-1/approve`, { operator: "operator" }),
      { params: Promise.resolve({ proposalId: "prop-1" }) },
    );
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/sync proposal approve exploded/i);
  });
});
