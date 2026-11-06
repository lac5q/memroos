// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { buildCanonicalIdentity } from "@/lib/memory/canonical";
import * as embeddingLifecycle from "@/lib/memory/embedding-lifecycle";
import { coordinateErasure } from "../erasure";

describe("erasure batch19b — removed embedding marks complete", () => {
  let db: Database.Database | null = null;

  afterEach(() => {
    db?.close();
    db = null;
    vi.restoreAllMocks();
  });

  it("coordinateErasure completes when embedding removal succeeds", async () => {
    db = new Database(":memory:");
    initSchema(db);
    const identity = buildCanonicalIdentity("embed-removed-b19b", "message", "ingress", "vector", {
      tenantId: "default-tenant",
    });
    identity.derivatives = [{ storeId: "vector", sourceHash: identity.canonicalHash, provenance: "test" }];
    vi.spyOn(embeddingLifecycle, "removeEmbeddingForCanonical").mockReturnValue({
      status: "purged",
      row: {
        id: "prov-removed",
        storeId: "vector",
        modelId: "model-a",
        modelVersion: null,
        adapterKind: "local",
      },
    } as never);

    const report = await coordinateErasure(db, identity, {
      tenantId: "default-tenant",
      actorId: "operator",
      scope: { tenantId: "default-tenant" },
    });
    expect(report.status).toBe("completed");
    expect(report.storeOutcomes.some((o) => o.storeId === "vector" && o.status === "purged")).toBe(true);
  });
});
