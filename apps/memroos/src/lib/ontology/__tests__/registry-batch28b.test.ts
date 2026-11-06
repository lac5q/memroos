// @vitest-environment node
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { ensureCanonicalUpperOntology, UPPER_ONTOLOGY_ID } from "../registry";

describe("ontology registry batch28b — canonical bootstrap idempotency", () => {
  it("ensureCanonicalUpperOntology returns the same active version on repeat calls", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const first = ensureCanonicalUpperOntology(db, "operator-b28b");
    const second = ensureCanonicalUpperOntology(db, "operator-b28b");
    expect(second.ontologyId).toBe(UPPER_ONTOLOGY_ID);
    expect(second.version).toBe(first.version);
    expect(second.contentHash).toBe(first.contentHash);
    const count = db
      .prepare("SELECT COUNT(*) AS cnt FROM ontology_versions WHERE ontology_id = ?")
      .get(UPPER_ONTOLOGY_ID) as { cnt: number };
    expect(count.cnt).toBe(1);
    db.close();
  });
});
