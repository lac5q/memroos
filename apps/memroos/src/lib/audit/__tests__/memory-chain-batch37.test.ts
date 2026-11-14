// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { buildMemoryAuditEntry } from "@/lib/audit/memory-chain";

describe("memory-chain batch37 — sanitizeMemoryMetadata (190)", () => {
  it("drops long body/content strings from metadata", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const longBody = "x".repeat(600);
    const built = buildMemoryAuditEntry(db, {
      tenantId: "default-tenant",
      actorId: "operator-b37",
      actorRole: "operator",
      eventType: "memory.write",
      entityId: `entity-b37-${randomUUID().slice(0, 8)}`,
      metadata: {
        messageBody: longBody,
        note: "ok-b37",
      },
    });
    const metadata = JSON.parse(built.metadata_json) as Record<string, unknown>;
    expect(metadata.messageBody).toBeUndefined();
    expect(metadata.note).toBe("ok-b37");
    db.close();
  });
});