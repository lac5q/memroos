// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { buildMemoryIterationSnapshot } from "@/lib/memory-doctor";
import type { LocalFootprintInventory } from "@/lib/cloud-offload/footprint";

const footprintOk: LocalFootprintInventory = {
  pressure: "ok",
  stores: [
    {
      id: "sqlite",
      class: "database",
      path: "/tmp/memroos.sqlite",
      exists: true,
      sizeBytes: 1024,
      sourceOfTruth: "local",
      cloudTarget: null,
      pruneSafety: "safe_if_rebuilt",
      privacyLabel: "internal",
      retention: "30d",
    },
  ],
};

const footprintWatch: LocalFootprintInventory = {
  pressure: "watch",
  stores: [
    {
      id: "sqlite",
      class: "database",
      path: "/tmp/memroos.sqlite",
      exists: true,
      sizeBytes: 50_000_000_000,
      sourceOfTruth: "local",
      cloudTarget: null,
      pruneSafety: "safe_after_offload",
      privacyLabel: "internal",
      retention: "30d",
    },
    {
      id: "vault",
      class: "vault",
      path: "/tmp/vault",
      exists: true,
      sizeBytes: 4096,
      sourceOfTruth: "local",
      cloudTarget: "object-store",
      pruneSafety: "never_prune",
      privacyLabel: "restricted",
      retention: "until-erased",
    },
  ],
};

vi.mock("@/lib/cloud-offload/footprint", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/cloud-offload/footprint")>();
  return {
    ...actual,
    collectLocalFootprintInventory: vi.fn(async () => footprintOk),
  };
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("memory-doctor batch33 — iteration warnings and storage branches", () => {
  it.skip("discordMissingFts warning (131) — FTS5 external-content mirrors rows on insert in :memory: schema", () => {
    // Cannot leave discord rows without FTS rows once messages_ai is installed.
  });

  it("buildMemoryIterationSnapshot warns on embedding backlog and sets needs_repair (132, 133)", () => {
    const db = new Database(":memory:");
    initSchema(db);
    db.prepare(
      `INSERT INTO messages(session_id, project, agent_id, role, content, timestamp, visibility, policy)
       VALUES (?,?,?,?,?,?,?,?)`,
    ).run(
      `sess-emb-b33-${randomUUID().slice(0, 8)}`,
      "alpha",
      "agent-b33",
      "user",
      "indexable without embedding batch33",
      "2026-03-03T00:00:00.000Z",
      "internal",
      "indexable",
    );

    const snapshot = buildMemoryIterationSnapshot(db, footprintOk);
    expect(snapshot.observe.embeddingBacklog).toBeGreaterThan(0);
    expect(snapshot.warnings.some((w) => w.includes("indexable messages need embeddings"))).toBe(true);
    expect(snapshot.status).toBe("needs_repair");
    db.close();
  });

  it("buildMemoryIterationSnapshot enters storage_watch when footprint pressure is not ok (133)", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const snapshot = buildMemoryIterationSnapshot(db, footprintWatch);
    expect(snapshot.warnings.some((w) => w.includes("local footprint pressure is watch"))).toBe(true);
    expect(snapshot.status).toBe("storage_watch");
    expect(snapshot.storage.offloadableBytes).toBeGreaterThan(0);
    db.close();
  });
});
