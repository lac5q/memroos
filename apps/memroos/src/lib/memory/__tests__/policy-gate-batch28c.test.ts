// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  authorizeMemoryUse,
  extractMemoryLabelSnapshot,
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

describe("policy-gate batch28c — label parsing and space membership", () => {
  it("extractMemoryLabelSnapshot normalizes owner and space ids (lines 89-102)", () => {
    const snapshot = extractMemoryLabelSnapshot({
      visibility: "internal",
      ownerUserId: "  user-28c  ",
      spaceId: "",
      domain: null,
    });
    expect(snapshot?.ownerUserId).toBe("user-28c");
    expect(snapshot?.spaceId).toBeNull();
  });

  it("resolveActorSpaceIds returns precomputed membership without querying (line 286)", () => {
    const database = freshDb();
    const spaces = resolveActorSpaceIds(database, {
      id: "actor-28c",
      role: "operator",
      spaceIds: ["space-a", "space-b"],
    });
    expect(spaces).toEqual(["space-a", "space-b"]);
  });

  it("resolveActorSpaceIds loads memberships from space_members (lines 288-292)", () => {
    const database = freshDb();
    const memberId = `member-${randomUUID().slice(0, 8)}`;
    database.prepare(`INSERT INTO spaces (id, tenant_id, name) VALUES (?, 'default-tenant', ?)`).run(
      "space-28c",
      "Space 28c",
    );
    database
      .prepare(
        `INSERT INTO space_members (space_id, member_id, member_type, role) VALUES (?, ?, 'human', 'viewer')`,
      )
      .run("space-28c", memberId);

    const spaces = resolveActorSpaceIds(database, { id: memberId, role: "operator" });
    expect(spaces).toEqual(["space-28c"]);
  });

  it("authorizeMemoryUse denies anonymous actors on non-public visibility (lines 246-247)", () => {
    const database = freshDb();
    const label = extractMemoryLabelSnapshot({
      visibility: "internal",
      policy: "indexable",
      spaceId: "space-28c",
    });
    expect(label).toBeDefined();
    const decision = authorizeMemoryUse({
      actor: { id: "", role: "anonymous", spaceIds: ["space-28c"] },
      purpose: "recall",
      label: label!,
    });
    expect(decision.decision).toBe("deny");
    expect(decision.reason).toBe("anonymous_actor");
  });
});
