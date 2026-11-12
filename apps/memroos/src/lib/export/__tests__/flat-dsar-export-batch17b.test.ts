// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { buildKnowledgeAuditEntry } from "@/lib/audit/knowledge-chain";
import { writeAuditEntry } from "@/lib/audit/write";
import { exportFlatVault, verifyFlatExportManifest } from "../flat-export";
import { listVaultPathsForUser } from "../dsar-export";

const ROOT = path.join(os.tmpdir(), `export-b17b-${crypto.randomUUID()}`);

afterEach(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
});

describe("flat + dsar export batch17b — tarball and audit path harvest", () => {
  it("exportFlatVault writes archive and verifiable manifest", () => {
    const tenantId = "tenant-export-b17b";
    const vault = path.join(ROOT, "tenants", tenantId);
    fs.mkdirSync(path.join(vault, "docs"), { recursive: true });
    fs.writeFileSync(path.join(vault, "docs", "MEMORY.md"), "# Memory\n", "utf8");
    const outDir = path.join(ROOT, "out");
    const result = exportFlatVault({
      tenantId,
      vaultRoot: path.join(ROOT, "tenants"),
      outDir,
      gitSha: "test-sha-b17b",
      signingKey: "hmac-key-b17b",
      now: new Date("2026-07-10T00:00:00.000Z"),
    });
    expect(fs.existsSync(result.archivePath)).toBe(true);
    expect(fs.existsSync(result.manifestPath)).toBe(true);
    expect(result.manifest.fileCount).toBe(1);
    expect(verifyFlatExportManifest(result.manifest, "hmac-key-b17b")).toBe(true);
  });

  it("listVaultPathsForUser dedupes paths from knowledge audit stream", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const userId = `user-${crypto.randomUUID().slice(0, 8)}`;
    for (const pathName of ["docs/a.md", "docs/a.md", "docs/b.md"]) {
      const entry = buildKnowledgeAuditEntry(db, {
        tenantId: "default-tenant",
        actorId: "operator",
        actorRole: "operator",
        path: pathName,
        operation: "write",
        agentId: "agent-1",
        userId,
        opHash: `sha256:${crypto.createHash("sha256").update(pathName).digest("hex")}`,
      });
      writeAuditEntry(
        {
          id: entry.id,
          tenant_id: entry.tenantId,
          actor_id: entry.actorId,
          actor_role: entry.actorRole,
          event_type: entry.eventType,
          entity_type: entry.entityType,
          entity_id: entry.entityId,
          reason: entry.reason,
          metadata_json: entry.metadata_json,
          created_at: entry.created_at,
        },
        db,
      );
    }
    expect(listVaultPathsForUser(db, "default-tenant", userId)).toEqual(["docs/a.md", "docs/b.md"]);
    db.close();
  });
});
