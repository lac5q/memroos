// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  computeTreeHash,
  exportFlatVault,
  resolveTenantVaultPath,
  verifyFlatExportManifest,
} from "@/lib/export/flat-export";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "flat-export-"));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("flat-export (ENTOPS-08)", () => {
  it("falls back to flat tenant layout and default vault root env", () => {
    const vaultRoot = path.join(tmpRoot, "knowledge");
    const flatPath = path.join(vaultRoot, "legacy-tenant");
    fs.mkdirSync(flatPath, { recursive: true });
    expect(resolveTenantVaultPath("legacy-tenant", vaultRoot)).toBe(flatPath);

    const prevKnowledge = process.env.KNOWLEDGE_ROOT;
    process.env.KNOWLEDGE_ROOT = vaultRoot;
    expect(resolveTenantVaultPath("missing-tenant")).toBe(
      path.join(vaultRoot, "tenants", "missing-tenant"),
    );
    if (prevKnowledge === undefined) delete process.env.KNOWLEDGE_ROOT;
    else process.env.KNOWLEDGE_ROOT = prevKnowledge;
  });

  it("skips git and node_modules when hashing and honors MEMORY.md", () => {
    const vault = path.join(tmpRoot, "tenants", "scan");
    fs.mkdirSync(path.join(vault, ".git"), { recursive: true });
    fs.writeFileSync(path.join(vault, ".git", "HEAD"), "ref");
    fs.mkdirSync(path.join(vault, "node_modules", "pkg"), { recursive: true });
    fs.writeFileSync(path.join(vault, "node_modules", "pkg", "index.js"), "ignored");
    fs.writeFileSync(path.join(vault, "MEMORY.md"), "memory root\n");
    fs.writeFileSync(path.join(vault, "notes.md"), "note\n");

    const hashed = computeTreeHash(vault);
    expect(hashed.fileCount).toBe(2);
    expect(hashed.files.map((entry) => entry.relativePath).sort()).toEqual(["MEMORY.md", "notes.md"]);
  });

  it("resolves operator tenants/<id> layout preferentially", () => {
    const vaultRoot = path.join(tmpRoot, "knowledge");
    const tenantsPath = path.join(vaultRoot, "tenants", "acme");
    fs.mkdirSync(tenantsPath, { recursive: true });
    fs.writeFileSync(path.join(tenantsPath, "notes.md"), "# hello\n");
    expect(resolveTenantVaultPath("acme", vaultRoot)).toBe(tenantsPath);
  });

  it("computeTreeHash is deterministic for the same tree", () => {
    const vault = path.join(tmpRoot, "tenants", "t1");
    fs.mkdirSync(vault, { recursive: true });
    fs.writeFileSync(path.join(vault, "a.md"), "alpha\n");
    fs.writeFileSync(path.join(vault, "b.md"), "beta\n");
    const first = computeTreeHash(vault);
    const second = computeTreeHash(vault);
    expect(first.treeHash).toBe(second.treeHash);
    expect(first.fileCount).toBe(2);
  });

  it("exportFlatVault produces tarball + signed manifest", () => {
    const vaultRoot = path.join(tmpRoot, "knowledge");
    const tenantVault = path.join(vaultRoot, "tenants", "default-tenant");
    fs.mkdirSync(tenantVault, { recursive: true });
    fs.writeFileSync(path.join(tenantVault, "readme.md"), "# vault\nsecret-free\n");

    const outDir = path.join(tmpRoot, "out");
    const result = exportFlatVault({
      tenantId: "default-tenant",
      vaultRoot,
      outDir,
      gitSha: "deadbeef",
      signingKey: "test-signing-key",
      now: new Date("2026-07-16T20:00:00.000Z"),
    });

    expect(fs.existsSync(result.archivePath)).toBe(true);
    expect(result.archivePath.endsWith(".tar.gz")).toBe(true);
    expect(fs.existsSync(result.manifestPath)).toBe(true);
    expect(result.manifest.gitSha).toBe("deadbeef");
    expect(result.manifest.treeHash.startsWith("sha256:")).toBe(true);
    expect(result.manifest.signatureAlg).toBe("hmac-sha256");
    expect(result.manifest.fileCount).toBe(1);
    expect(verifyFlatExportManifest(result.manifest, "test-signing-key")).toBe(true);
    expect(verifyFlatExportManifest(result.manifest, "wrong-key")).toBe(false);
  });

  it("self-signs when no signing key is provided", () => {
    const vaultRoot = path.join(tmpRoot, "knowledge");
    const tenantVault = path.join(vaultRoot, "tenants", "solo");
    fs.mkdirSync(tenantVault, { recursive: true });
    fs.writeFileSync(path.join(tenantVault, "x.md"), "x\n");

    const result = exportFlatVault({
      tenantId: "solo",
      vaultRoot,
      outDir: path.join(tmpRoot, "out2"),
      gitSha: crypto.randomBytes(4).toString("hex"),
    });
    expect(result.manifest.signatureAlg).toBe("sha256-self");
    expect(verifyFlatExportManifest(result.manifest)).toBe(true);
  });
});
