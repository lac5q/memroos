// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { authorizeMemoryUse, extractMemoryLabelSnapshot, resolveActorSpaceIds } from "../policy-gate";

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

describe("policy-gate batch31 — owner/space reader branches", () => {
  it("extractMemoryLabelSnapshot preserves explicit null owner and rejects non-string space ids (lines 91, 99)", () => {
    const snapshot = extractMemoryLabelSnapshot({
      visibility: "internal",
      policy: "indexable",
      ownerUserId: null,
      owner_user_id: null,
      spaceId: 404,
      space_id: { invalid: true },
    });
    expect(snapshot?.ownerUserId).toBeNull();
    expect(snapshot?.spaceId).toBeUndefined();
  });

  it("extractMemoryLabelSnapshot treats blank owner ids as null", () => {
    const snapshot = extractMemoryLabelSnapshot({
      visibility: "private",
      policy: "sealed",
      owner_user_id: "   ",
    });
    expect(snapshot?.ownerUserId).toBeNull();
  });

  it("authorizeMemoryUse allows operator recall on internal indexable labels in actor space", () => {
    const database = freshDb();
    const spaceId = `space-b31-${randomUUID().slice(0, 6)}`;
    database.prepare(`INSERT INTO spaces (id, tenant_id, name) VALUES (?, 'default-tenant', ?)`).run(spaceId, "Batch31");
    database
      .prepare(`INSERT INTO space_members (space_id, member_id, member_type, role) VALUES (?, ?, 'human', 'operator')`)
      .run(spaceId, "operator-b31");

    const spaces = resolveActorSpaceIds(database, { id: "operator-b31", role: "operator" });
    expect(spaces).toContain(spaceId);

    const label = extractMemoryLabelSnapshot({
      visibility: "internal",
      policy: "indexable",
      spaceId,
    });
    const decision = authorizeMemoryUse({
      actor: { id: "operator-b31", role: "operator", spaceIds: [spaceId] },
      purpose: "recall",
      label: label!,
    });
    expect(decision.decision).toBe("allow");
  });
});
