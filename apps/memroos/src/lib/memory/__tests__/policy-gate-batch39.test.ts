// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import type { MemoryLabelSnapshot } from "../policy-gate";
import {
  authorizeMemoryUse,
  extractMemoryLabelSnapshot,
  filterAuthorizedMessageRows,
  resolveActorSpaceIds,
} from "../policy-gate";

let db: Database.Database | null = null;

function freshDb(): Database.Database {
  db = new Database(":memory:");
  initSchema(db);
  return db;
}

afterEach(() => {
  db?.close();
  db = null;
});

describe("policy-gate batch39 — remaining branches", () => {
  it("authorizeMemoryUse returns redact for requires_redaction (229)", () => {
    const decision = authorizeMemoryUse({
      actor: { id: `user-${randomUUID().slice(0, 8)}`, role: "operator" },
      purpose: "recall",
      label: { visibility: "internal", policy: "requires_redaction" },
    });
    expect(decision).toMatchObject({ decision: "redact", reason: "redaction_required" });
  });

  it("authorizeMemoryUse denies internal labels with unrecognized policy (253)", () => {
    const decision = authorizeMemoryUse({
      actor: { id: `agent-${randomUUID().slice(0, 8)}`, role: "agent" },
      purpose: "recall",
      label: {
        visibility: "internal",
        policy: "not_a_vault_policy" as never,
      } satisfies MemoryLabelSnapshot,
    });
    expect(decision).toMatchObject({ decision: "deny", reason: "unrecognized_policy" });
  });

  it("filterAuthorizedMessageRows audits medium severity for requires_redaction (319)", () => {
    const database = freshDb();
    const sessionId = `batch39-${randomUUID()}`;
    database
      .prepare(
        `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
         VALUES (?, 'memroos', 'codex', 'user', 'redact me', '2026-11-16T00:00:00Z', 'internal', 'requires_redaction')`,
      )
      .run(sessionId);

    const rows = database.prepare("SELECT id FROM messages WHERE session_id = ?").all(sessionId) as Array<{ id: number }>;
    const filtered = filterAuthorizedMessageRows(
      database,
      rows,
      { id: `operator-${randomUUID().slice(0, 8)}`, role: "operator" },
      "recall",
    );

    expect(filtered).toHaveLength(0);
    const audit = database
      .prepare(
        `SELECT severity, detail FROM audit_log WHERE action = 'memory_policy_decision' AND target = ?`,
      )
      .get(`message:${rows[0].id}`) as { severity: string; detail: string };
    expect(audit.severity).toBe("medium");
    expect(audit.detail).toContain("redaction_required");
  });

  it("extractMemoryLabelSnapshot merges nested metadata.label into top-level visibility (159-176)", () => {
    const snapshot = extractMemoryLabelSnapshot({
      visibility: "internal",
      metadata: {
        label: {
          domain: "engineering",
          sensitivity: "pii",
          policy: "indexable",
        },
      },
    });
    expect(snapshot).toEqual({
      visibility: "internal",
      domain: "engineering",
      sensitivity: "pii",
      policy: "indexable",
      ownerUserId: undefined,
      spaceId: undefined,
    });
  });

  it("resolveActorSpaceIds returns [] when space_members query fails (293)", () => {
    const fakeDb = {
      prepare: () => {
        throw new Error("no table");
      },
    } as unknown as Database.Database;

    const spaces = resolveActorSpaceIds(fakeDb, { id: `actor-${randomUUID().slice(0, 8)}`, role: "operator" });
    expect(spaces).toEqual([]);
  });

  it("resolveActorSpaceIds returns [] for empty actor id (287)", () => {
    const database = freshDb();
    expect(resolveActorSpaceIds(database, { id: "", role: "operator" })).toEqual([]);
  });

  it("resolveActorSpaceIds returns [] for anonymous role (287)", () => {
    const database = freshDb();
    expect(resolveActorSpaceIds(database, { id: `anon-${randomUUID().slice(0, 8)}`, role: "anonymous" })).toEqual(
      [],
    );
  });

  it("extractMemoryLabelSnapshot keeps null domain/sensitivity and ignores non-string owner/space (105-125)", () => {
    const snapshot = extractMemoryLabelSnapshot({
      visibility: "internal",
      policy: "indexable",
      domain: null,
      sensitivity: null,
      ownerUserId: 42,
      owner_user_id: { bad: true },
      spaceId: false,
      space_id: ["nope"],
    });
    expect(snapshot?.domain).toBeNull();
    expect(snapshot?.sensitivity).toBeNull();
    expect(snapshot?.ownerUserId).toBeUndefined();
    expect(snapshot?.spaceId).toBeUndefined();
  });
});