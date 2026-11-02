// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

import { computeTreeHash, resolveTenantVaultPath, verifyFlatExportManifest } from "../flat-export";

const ROOT = path.join(os.tmpdir(), `flat-b16b-${crypto.randomUUID()}`);

afterEach(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
});

describe("flat-export batch16b — path resolution and manifest verify", () => {
  it("resolveTenantVaultPath prefers tenants/<id> layout", () => {
    const tenantId = "tenant-layout";
    const tenantsPath = path.join(ROOT, "tenants", tenantId);
    fs.mkdirSync(tenantsPath, { recursive: true });
    expect(resolveTenantVaultPath(tenantId, ROOT)).toBe(tenantsPath);
  });

  it("resolveTenantVaultPath falls back to flat tenant directory", () => {
    const tenantId = "flat-tenant";
    const flatPath = path.join(ROOT, "flat-layout", tenantId);
    fs.mkdirSync(flatPath, { recursive: true });
    expect(resolveTenantVaultPath(tenantId, path.join(ROOT, "flat-layout"))).toBe(flatPath);
  });

  it("computeTreeHash skips node_modules and .git directories", () => {
    const vault = path.join(ROOT, "vault-skip");
    fs.mkdirSync(path.join(vault, ".git"), { recursive: true });
    fs.mkdirSync(path.join(vault, "node_modules", "pkg"), { recursive: true });
    fs.mkdirSync(path.join(vault, "notes"), { recursive: true });
    fs.writeFileSync(path.join(vault, "notes", "MEMORY.md"), "# Memory\n");
    fs.writeFileSync(path.join(vault, ".git", "HEAD"), "ref");
    fs.writeFileSync(path.join(vault, "node_modules", "pkg", "index.md"), "skip");
    const { fileCount, files } = computeTreeHash(vault);
    expect(fileCount).toBe(1);
    expect(files[0]?.relativePath).toBe("notes/MEMORY.md");
  });

  it("verifyFlatExportManifest validates hmac-sha256 signatures", () => {
    const body = {
      version: 1 as const,
      kind: "memroos-flat-export" as const,
      tenantId: "default-tenant",
      vaultPath: "/tmp/vault",
      createdAt: "2026-07-01T00:00:00.000Z",
      gitSha: "abc123",
      treeHash: "sha256:deadbeef",
      fileCount: 1,
      archiveRelativePath: "archive.tar.gz",
    };
    const key = "signing-key-b16b";
    const canonical = JSON.stringify(body, Object.keys(body).sort());
    const hmac = crypto.createHmac("sha256", key).update(canonical, "utf8").digest("hex");
    const manifest = {
      ...body,
      signature: `hmac-sha256:${hmac}`,
      signatureAlg: "hmac-sha256" as const,
    };
    expect(verifyFlatExportManifest(manifest, key)).toBe(true);
    expect(verifyFlatExportManifest(manifest, "wrong-key")).toBe(false);
  });
});
