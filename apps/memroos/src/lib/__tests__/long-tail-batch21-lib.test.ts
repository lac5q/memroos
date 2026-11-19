// @vitest-environment node
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { scanIrisPreflight } from "@/lib/iris-scanner";
import { buildOkfBundle, buildOkfConceptFromMemory } from "@/lib/okf";
import { createSpace } from "@/lib/space";
import {
  createDocumentDirectoryEntry,
  updateDocumentDirectoryEntry,
} from "@/lib/write-rules";
import type { MemoryEntry } from "@/types";

describe("long-tail batch21 lib", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
  });

  afterEach(() => {
    db.close();
    vi.restoreAllMocks();
  });

  it("createSpace falls back to randomBytes when randomUUID is unavailable", () => {
    const original = crypto.randomUUID;
    // @ts-expect-error test stub
    crypto.randomUUID = undefined;
    try {
      const space = createSpace(db, { tenantId: "default-tenant", name: "Fallback Space" });
      expect(space.id.startsWith("spc_")).toBe(true);
      expect(space.id.length).toBeGreaterThan(10);
    } finally {
      crypto.randomUUID = original;
    }
  });

  it("buildOkfBundle serializes numeric frontmatter values", () => {
    const memory: MemoryEntry = {
      id: "note/num.md",
      content: "Numeric metadata case.",
      agent: "codex",
      date: "2026-06-13T18:00:00.000Z",
      type: "note",
      source: "test",
    };
    const concept = buildOkfConceptFromMemory(memory, { tags: ["memory"] });
    concept.content = concept.content.replace(
      "---\n",
      "---\npriority: 3\n",
    );
    const bundle = buildOkfBundle({ name: "Numeric", concepts: [concept], timestamp: "2026-06-13T19:00:00.000Z" });
    expect(bundle["memory/note/num.md"]).toMatch(/priority: 3/);
  });

  it("scanIrisPreflight accumulates medium-severity content findings in riskScore", () => {
    const result = scanIrisPreflight("Call me at 415-555-0123 for follow-up.");
    expect(result.blocked).toBe(false);
    expect(result.riskScore).toBeGreaterThanOrEqual(40);
  });

  it("updateDocumentDirectoryEntry rethrows non-unique update failures", () => {
    db.prepare(`INSERT OR IGNORE INTO tenants (id, name) VALUES ('default-tenant', 'Default')`).run();
    const spaceId = `space-${crypto.randomUUID().slice(0, 8)}`;
    db.prepare(`INSERT INTO spaces (id, tenant_id, name) VALUES (?, 'default-tenant', ?)`).run(spaceId, spaceId);
    const entry = createDocumentDirectoryEntry(db, { spaceId, name: "Docs", actorId: "operator" });
    const originalPrepare = db.prepare.bind(db);
    vi.spyOn(db, "prepare").mockImplementation((sql: unknown) => {
      const stmt = originalPrepare(sql as string);
      if (typeof sql === "string" && sql.includes("UPDATE document_directory")) {
        return {
          run: () => {
            throw new Error("disk full");
          },
          get: stmt.get.bind(stmt),
          all: stmt.all.bind(stmt),
        } as ReturnType<typeof db.prepare>;
      }
      return stmt;
    });

    expect(() =>
      updateDocumentDirectoryEntry(db, entry.id, {
        expectedVersion: 1,
        actorId: "operator",
        purpose: "ops runbooks",
      }),
    ).toThrow(/disk full/);
  });
});
