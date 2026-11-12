// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { replayVaultArtifactWithDurability } from "../vault-durability";

describe("vault-durability batch35b", () => {
  let db: Database.Database;

  afterEach(() => {
    db?.close();
  });

  it("loadDurabilityRow returns null when durability table missing (381)", () => {
    db = new Database(":memory:");
    initSchema(db);
    db.exec("DROP TABLE IF EXISTS memory_vault_durability");
    const artifactId = `art-b35b-${randomUUID().slice(0, 8)}`;
    expect(() => replayVaultArtifactWithDurability(db, "default-tenant", artifactId, "operator")).toThrow(
      /vault durability row missing/,
    );
  });
});
