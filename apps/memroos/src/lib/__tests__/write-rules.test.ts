// @vitest-environment node
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { initSchema } from "@/lib/db-schema";
import { createSpace } from "@/lib/space";
import {
  validateWriteRule,
  createWriteRule,
  getWriteRules,
  updateWriteRule,
  deleteWriteRule,
  resolveWriteTarget,
  createDocumentDirectoryEntry,
  getDocumentDirectory,
  updateDocumentDirectoryEntry,
  deleteDocumentDirectoryEntry,
  checkWriteRuleDrift,
} from "@/lib/write-rules";

function freshDb(): Database.Database {
  const db = new Database(":memory:");
  initSchema(db);
  return db;
}

function setup(): {
  db: Database.Database;
  spaceId: string;
  secondSpaceId: string;
  actorId: string;
} {
  const db = freshDb();
  const space = createSpace(db, { tenantId: "default-tenant", name: "growth" });
  const secondSpace = createSpace(db, { tenantId: "default-tenant", name: "ops" });
  const actorId = "user-1";
  return {
    db,
    spaceId: space.id,
    secondSpaceId: secondSpace.id,
    actorId,
  };
}

function countAuditRows(db: Database.Database, eventType: string): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM audit_entries WHERE event_type = ?")
    .get(eventType) as { n: number };
  return row.n;
}

describe("write-rules.ts (Phase 138 / WRITERULES-01..06)", () => {
  let db: Database.Database;
  let spaceId: string;
  let secondSpaceId: string;
  let actorId: string;

  beforeEach(() => {
    ({ db, spaceId, secondSpaceId, actorId } = setup());
  });

  // --- validateWriteRule (WRITERULES-06) ---

  it("1) validateWriteRule accepts valid input and defaults fallbackRule to reject", () => {
    const result = validateWriteRule({
      dataType: "decision_intent",
      targetDocument: "decisions.md",
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("2) validateWriteRule rejects empty dataType, empty targetDocument, and invalid fallbackRule", () => {
    const result = validateWriteRule({
      dataType: "",
      targetDocument: "",
      fallbackRule: "allow",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
    expect(result.errors.some((e) => e.includes("dataType"))).toBe(true);
    expect(result.errors.some((e) => e.includes("targetDocument"))).toBe(true);
    expect(result.errors.some((e) => e.includes("fallbackRule"))).toBe(true);
  });

  it("3) validateWriteRule accepts fallbackRule='default_doc'", () => {
    const result = validateWriteRule({
      dataType: "lesson",
      targetDocument: "lessons.md",
      fallbackRule: "default_doc",
    });
    expect(result.valid).toBe(true);
  });

  // --- createWriteRule (WRITERULES-01) ---

  it("4) createWriteRule inserts a rule, writes audit, and returns it with version=1", () => {
    expect(countAuditRows(db, "write_rule.created")).toBe(0);
    const rule = createWriteRule(db, {
      spaceId,
      dataType: "decision_intent",
      targetDocument: "decisions.md",
      actorId,
    });
    expect(rule.id).toBeGreaterThan(0);
    expect(rule.spaceId).toBe(spaceId);
    expect(rule.dataType).toBe("decision_intent");
    expect(rule.targetDocument).toBe("decisions.md");
    expect(rule.fallbackRule).toBe("reject");
    expect(rule.version).toBe(1);
    expect(rule.createdBy).toBe(actorId);
    expect(rule.updatedAt).toBeNull();
    expect(rule.updatedBy).toBeNull();
    expect(countAuditRows(db, "write_rule.created")).toBe(1);
  });

  it("5) createWriteRule rejects duplicate (space_id, data_type)", () => {
    createWriteRule(db, {
      spaceId,
      dataType: "lesson",
      targetDocument: "lessons.md",
      actorId,
    });
    expect(() =>
      createWriteRule(db, {
        spaceId,
        dataType: "lesson",
        targetDocument: "other.md",
        actorId,
      }),
    ).toThrow(/already exists/);
  });

  it("6) createWriteRule throws on invalid input (empty dataType)", () => {
    expect(() =>
      createWriteRule(db, {
        spaceId,
        dataType: "",
        targetDocument: "doc.md",
        actorId,
      }),
    ).toThrow(/invalid input/);
  });

  // --- getWriteRules ---

  it("7) getWriteRules returns all rules ordered by data_type ASC", () => {
    createWriteRule(db, {
      spaceId,
      dataType: "zebra",
      targetDocument: "z.md",
      actorId,
    });
    createWriteRule(db, {
      spaceId,
      dataType: "alpha",
      targetDocument: "a.md",
      actorId,
    });
    const rules = getWriteRules(db, spaceId);
    expect(rules).toHaveLength(2);
    expect(rules[0].dataType).toBe("alpha");
    expect(rules[1].dataType).toBe("zebra");
  });

  it("8) getWriteRules returns empty for unknown space or empty spaceId", () => {
    expect(getWriteRules(db, "spc_nonexistent")).toEqual([]);
    expect(getWriteRules(db, "")).toEqual([]);
  });

  // --- updateWriteRule (WRITERULES-05) ---

  it("9) updateWriteRule updates fields, increments version, and writes audit", () => {
    const rule = createWriteRule(db, {
      spaceId,
      dataType: "task_state",
      targetDocument: "tasks.md",
      actorId,
    });
    const updated = updateWriteRule(db, rule.id, {
      targetDocument: "tasks-v2.md",
      fallbackRule: "default_doc",
      actorId,
      expectedVersion: 1,
    });
    expect(updated.targetDocument).toBe("tasks-v2.md");
    expect(updated.fallbackRule).toBe("default_doc");
    expect(updated.version).toBe(2);
    expect(updated.updatedAt).not.toBeNull();
    expect(updated.updatedBy).toBe(actorId);
    expect(countAuditRows(db, "write_rule.updated")).toBe(1);
  });

  it("10) updateWriteRule throws on version conflict", () => {
    const rule = createWriteRule(db, {
      spaceId,
      dataType: "runbook",
      targetDocument: "runbooks.md",
      actorId,
    });
    expect(() =>
      updateWriteRule(db, rule.id, {
        targetDocument: "other.md",
        actorId,
        expectedVersion: 99,
      }),
    ).toThrow(/version conflict/);
  });

  it("11) updateWriteRule throws on unknown rule", () => {
    expect(() =>
      updateWriteRule(db, 99999, {
        targetDocument: "x.md",
        actorId,
        expectedVersion: 1,
      }),
    ).toThrow(/not found/);
  });

  // --- deleteWriteRule (WRITERULES-05) ---

  it("12) deleteWriteRule removes the rule and writes audit", () => {
    const rule = createWriteRule(db, {
      spaceId,
      dataType: "source_pointer",
      targetDocument: "sources.md",
      actorId,
    });
    deleteWriteRule(db, rule.id, { actorId, expectedVersion: 1 });
    expect(getWriteRules(db, spaceId)).toHaveLength(0);
    expect(countAuditRows(db, "write_rule.deleted")).toBe(1);
  });

  it("13) deleteWriteRule throws on version conflict", () => {
    const rule = createWriteRule(db, {
      spaceId,
      dataType: "verification",
      targetDocument: "verif.md",
      actorId,
    });
    expect(() =>
      deleteWriteRule(db, rule.id, { actorId, expectedVersion: 42 }),
    ).toThrow(/version conflict/);
  });

  // --- resolveWriteTarget (WRITERULES-02) ---

  it("14) resolveWriteTarget returns matched=true on exact data_type match", () => {
    createWriteRule(db, {
      spaceId,
      dataType: "decision_intent",
      targetDocument: "decisions.md",
      actorId,
    });
    const result = resolveWriteTarget(db, spaceId, "decision_intent");
    expect(result.matched).toBe(true);
    expect(result.targetDocument).toBe("decisions.md");
    expect(result.receiptReason).toBe("matched");
  });

  it("15) resolveWriteTarget uses default_doc fallback when no exact match", () => {
    createWriteRule(db, {
      spaceId,
      dataType: "default",
      targetDocument: "catch-all.md",
      fallbackRule: "default_doc",
      actorId,
    });
    const result = resolveWriteTarget(db, spaceId, "unknown_type");
    expect(result.matched).toBe(true);
    expect(result.targetDocument).toBe("catch-all.md");
    expect(result.receiptReason).toBe("fallback");
  });

  it("16) resolveWriteTarget returns matched=false and writes mismatch audit when reject fallback", () => {
    createWriteRule(db, {
      spaceId,
      dataType: "decision_intent",
      targetDocument: "decisions.md",
      actorId,
    });
    expect(countAuditRows(db, "write_rule.mismatch")).toBe(0);
    const result = resolveWriteTarget(db, spaceId, "no_such_type");
    expect(result.matched).toBe(false);
    expect(result.targetDocument).toBeNull();
    expect(result.receiptReason).toBe(
      "no matching write rule and fallback is reject",
    );
    expect(countAuditRows(db, "write_rule.mismatch")).toBe(1);
  });

  it("17) resolveWriteTarget returns matched=false for empty inputs", () => {
    const result = resolveWriteTarget(db, "", "something");
    expect(result.matched).toBe(false);
    expect(result.targetDocument).toBeNull();
  });

  // --- createDocumentDirectoryEntry (WRITERULES-03) ---

  it("18) createDocumentDirectoryEntry inserts an entry, writes audit, and returns it", () => {
    expect(countAuditRows(db, "document_dir.created")).toBe(0);
    const entry = createDocumentDirectoryEntry(db, {
      spaceId,
      name: "decisions.md",
      purpose: "Stores all decision intents",
      resourceId: "res_123",
      actorId,
    });
    expect(entry.id).toBeGreaterThan(0);
    expect(entry.spaceId).toBe(spaceId);
    expect(entry.name).toBe("decisions.md");
    expect(entry.purpose).toBe("Stores all decision intents");
    expect(entry.resourceId).toBe("res_123");
    expect(entry.version).toBe(1);
    expect(entry.createdBy).toBe(actorId);
    expect(entry.updatedAt).toBeNull();
    expect(countAuditRows(db, "document_dir.created")).toBe(1);
  });

  it("19) createDocumentDirectoryEntry rejects duplicate (space_id, name)", () => {
    createDocumentDirectoryEntry(db, {
      spaceId,
      name: "doc.md",
      actorId,
    });
    expect(() =>
      createDocumentDirectoryEntry(db, {
        spaceId,
        name: "doc.md",
        actorId,
      }),
    ).toThrow(/already exists/);
  });

  // --- getDocumentDirectory ---

  it("20) getDocumentDirectory returns entries ordered by name ASC", () => {
    createDocumentDirectoryEntry(db, { spaceId, name: "zeta.md", actorId });
    createDocumentDirectoryEntry(db, { spaceId, name: "alpha.md", actorId });
    const entries = getDocumentDirectory(db, spaceId);
    expect(entries).toHaveLength(2);
    expect(entries[0].name).toBe("alpha.md");
    expect(entries[1].name).toBe("zeta.md");
  });

  // --- updateDocumentDirectoryEntry (WRITERULES-05) ---

  it("21) updateDocumentDirectoryEntry updates fields, increments version, writes audit", () => {
    const entry = createDocumentDirectoryEntry(db, {
      spaceId,
      name: "lessons.md",
      purpose: "Original purpose",
      actorId,
    });
    const updated = updateDocumentDirectoryEntry(db, entry.id, {
      name: "lessons-v2.md",
      purpose: "Updated purpose",
      resourceId: "res_456",
      actorId,
      expectedVersion: 1,
    });
    expect(updated.name).toBe("lessons-v2.md");
    expect(updated.purpose).toBe("Updated purpose");
    expect(updated.resourceId).toBe("res_456");
    expect(updated.version).toBe(2);
    expect(updated.updatedAt).not.toBeNull();
    expect(updated.updatedBy).toBe(actorId);
    expect(countAuditRows(db, "document_dir.updated")).toBe(1);
  });

  it("22) updateDocumentDirectoryEntry throws on version conflict", () => {
    const entry = createDocumentDirectoryEntry(db, {
      spaceId,
      name: "conflict.md",
      actorId,
    });
    expect(() =>
      updateDocumentDirectoryEntry(db, entry.id, {
        name: "new.md",
        actorId,
        expectedVersion: 99,
      }),
    ).toThrow(/version conflict/);
  });

  it("22b) updateDocumentDirectoryEntry rejects empty names and duplicate names in a space", () => {
    const first = createDocumentDirectoryEntry(db, { spaceId, name: "alpha.md", actorId });
    createDocumentDirectoryEntry(db, { spaceId, name: "beta.md", actorId });
    expect(() =>
      updateDocumentDirectoryEntry(db, first.id, {
        name: "   ",
        actorId,
        expectedVersion: 1,
      }),
    ).toThrow(/name cannot be empty/);
    expect(() =>
      updateDocumentDirectoryEntry(db, first.id, {
        name: "beta.md",
        actorId,
        expectedVersion: 1,
      }),
    ).toThrow(/already exists/);
  });

  // --- deleteDocumentDirectoryEntry (WRITERULES-05) ---

  it("23) deleteDocumentDirectoryEntry removes the entry and writes audit", () => {
    const entry = createDocumentDirectoryEntry(db, {
      spaceId,
      name: "temp.md",
      actorId,
    });
    deleteDocumentDirectoryEntry(db, entry.id, { actorId, expectedVersion: 1 });
    expect(getDocumentDirectory(db, spaceId)).toHaveLength(0);
    expect(countAuditRows(db, "document_dir.deleted")).toBe(1);
  });

  it("24) deleteDocumentDirectoryEntry throws on version conflict", () => {
    const entry = createDocumentDirectoryEntry(db, {
      spaceId,
      name: "conflict-del.md",
      actorId,
    });
    expect(() =>
      deleteDocumentDirectoryEntry(db, entry.id, {
        actorId,
        expectedVersion: 77,
      }),
    ).toThrow(/version conflict/);
  });

  // --- checkWriteRuleDrift (WRITERULES-04) ---

  it("25) checkWriteRuleDrift returns isStale=false when agent version matches", () => {
    createWriteRule(db, {
      spaceId,
      dataType: "decision_intent",
      targetDocument: "decisions.md",
      actorId,
    });
    const result = checkWriteRuleDrift(db, spaceId, 1);
    expect(result.isStale).toBe(false);
    expect(result.currentVersion).toBe(1);
    expect(result.driftReceiptReason).toBe("current");
  });

  it("26) checkWriteRuleDrift returns isStale=true when agent version is behind", () => {
    const rule = createWriteRule(db, {
      spaceId,
      dataType: "lesson",
      targetDocument: "lessons.md",
      actorId,
    });
    updateWriteRule(db, rule.id, {
      targetDocument: "lessons-v2.md",
      actorId,
      expectedVersion: 1,
    });
    // Agent still thinks version is 1, but current is 2.
    const result = checkWriteRuleDrift(db, spaceId, 1);
    expect(result.isStale).toBe(true);
    expect(result.currentVersion).toBe(2);
    expect(result.driftReceiptReason).toBe("agent view is stale");
  });

  it("27b) checkWriteRuleDrift treats blank spaceId as current with version 0", () => {
    const result = checkWriteRuleDrift(db, "  ", 99);
    expect(result.isStale).toBe(false);
    expect(result.currentVersion).toBe(0);
    expect(result.driftReceiptReason).toBe("current");
  });

  it("27) checkWriteRuleDrift returns currentVersion=0 and isStale=false for space with no rules", () => {
    const result = checkWriteRuleDrift(db, spaceId, 0);
    expect(result.isStale).toBe(false);
    expect(result.currentVersion).toBe(0);
    expect(result.driftReceiptReason).toBe("current");
  });

  it("28) write rules and document directory entries are isolated per space", () => {
    createWriteRule(db, {
      spaceId,
      dataType: "decision_intent",
      targetDocument: "growth-decisions.md",
      actorId,
    });
    createWriteRule(db, {
      spaceId: secondSpaceId,
      dataType: "decision_intent",
      targetDocument: "ops-decisions.md",
      actorId,
    });

    // Same data_type in different spaces -> different targets.
    const growthResult = resolveWriteTarget(db, spaceId, "decision_intent");
    const opsResult = resolveWriteTarget(db, secondSpaceId, "decision_intent");
    expect(growthResult.targetDocument).toBe("growth-decisions.md");
    expect(opsResult.targetDocument).toBe("ops-decisions.md");

    // getWriteRules is space-scoped.
    expect(getWriteRules(db, spaceId)).toHaveLength(1);
    expect(getWriteRules(db, secondSpaceId)).toHaveLength(1);

    // Document directory is space-scoped.
    createDocumentDirectoryEntry(db, { spaceId, name: "doc-a.md", actorId });
    createDocumentDirectoryEntry(db, {
      spaceId: secondSpaceId,
      name: "doc-b.md",
      actorId,
    });
    expect(getDocumentDirectory(db, spaceId)).toHaveLength(1);
    expect(getDocumentDirectory(db, secondSpaceId)).toHaveLength(1);
  });

  it("29) updateWriteRule throws when the rule does not exist", () => {
    expect(() =>
      updateWriteRule(db, 99999, {
        targetDocument: "missing.md",
        actorId,
        expectedVersion: 1,
      }),
    ).toThrow(/not found/);
  });

  it("30) deleteDocumentDirectoryEntry throws when the entry does not exist", () => {
    expect(() =>
      deleteDocumentDirectoryEntry(db, 99999, { actorId, expectedVersion: 1 }),
    ).toThrow(/not found/);
  });

  it("31) createWriteRule rejects empty spaceId and actorId", () => {
    expect(() =>
      createWriteRule(db, {
        spaceId: " ",
        dataType: "decision_intent",
        targetDocument: "decisions.md",
        actorId,
      }),
    ).toThrow(/spaceId is required/);
    expect(() =>
      createWriteRule(db, {
        spaceId,
        dataType: "decision_intent",
        targetDocument: "decisions.md",
        actorId: " ",
      }),
    ).toThrow(/actorId is required/);
  });

  it("32) createWriteRule rejects duplicate data_type in the same space", () => {
    createWriteRule(db, {
      spaceId,
      dataType: "duplicate_type",
      targetDocument: "one.md",
      actorId,
    });
    expect(() =>
      createWriteRule(db, {
        spaceId,
        dataType: "duplicate_type",
        targetDocument: "two.md",
        actorId,
      }),
    ).toThrow(/already exists/);
  });
});
