// @vitest-environment node
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { ensureCanonicalUpperOntology } from "@/lib/ontology/registry";
import {
  OntologyGovernanceError,
  registerOntologyDerivative,
  registerOntologySource,
} from "@/lib/ontology/validity";

describe("ontology validity batch22b", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
    db.prepare(`INSERT OR IGNORE INTO tenants (id, name) VALUES ('default-tenant', 'Default')`).run();
    ensureCanonicalUpperOntology(db, "operator");
  });

  afterEach(() => {
    db.close();
  });

  it("registerOntologySource rejects blank required fields", () => {
    expect(() =>
      registerOntologySource(db, {
        tenantId: "default-tenant",
        spaceId: "space-a",
        sourceId: "   ",
        sourceHash: `sha256:${"a".repeat(64)}`,
        actor: "operator",
      }),
    ).toThrow(OntologyGovernanceError);
  });

  it("registerOntologyDerivative rejects inactive sources", () => {
    expect(() =>
      registerOntologyDerivative(db, {
        tenantId: "default-tenant",
        spaceId: "space-a",
        sourceId: "missing-src",
        sourceHash: `sha256:${"c".repeat(64)}`,
        derivativeType: "candidate",
        derivativeId: "deriv-b22b",
      }),
    ).toThrow(/source lifecycle is unavailable/);
  });
});
