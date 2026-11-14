// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { buildCanonicalIdentity } from "@/lib/memory/canonical";
import { getErasureStoreAdapter } from "../erasure";

let db: Database.Database | null = null;

afterEach(() => {
  db?.close();
  db = null;
});

describe("erasure batch37b — context adapter not_linked", () => {
  it("context erase reports not_linked without context derivative (680)", async () => {
    db = new Database(":memory:");
    initSchema(db);
    const identity = buildCanonicalIdentity(`ctx-b37b-${randomUUID().slice(0, 8)}`, "message", "ingress", "context", {
      tenantId: "default-tenant",
    });
    identity.derivatives = [{ storeId: "message", sourceHash: identity.canonicalHash, provenance: "batch37b" }];
    const adapter = getErasureStoreAdapter("context");
    const outcome = await adapter!.erase(db, "default-tenant", identity, {
      erasureId: `er-ctx-b37b-${randomUUID()}`,
      now: new Date(),
    });
    expect(outcome.status).toBe("zero_match");
    expect(outcome.reason).toBe("not_linked:context");
  });
});