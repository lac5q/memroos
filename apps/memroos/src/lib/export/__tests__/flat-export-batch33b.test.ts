// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { exportFlatVault } from "../flat-export";

let tmpRoot: string;

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  delete process.env.MEMROOS_GIT_SHA;
  delete process.env.SOURCE_VERSION;
});

describe("flat-export batch33b", () => {
  it("resolveGitSha falls back to unknown when git is unavailable (123)", () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), `flat-export-b33b-${randomUUID()}-`));
    const vaultRoot = path.join(tmpRoot, "knowledge");
    const tenantVault = path.join(vaultRoot, "tenants", "tenant-b33b");
    fs.mkdirSync(tenantVault, { recursive: true });
    fs.writeFileSync(path.join(tenantVault, "note.md"), "# b33b\n");

    const prevCwd = process.cwd();
    const fakeRepo = path.join(tmpRoot, "not-a-git-repo");
    fs.mkdirSync(fakeRepo, { recursive: true });
    process.chdir(fakeRepo);

    try {
      const outDir = path.join(tmpRoot, "out");
      const result = exportFlatVault({
        tenantId: "tenant-b33b",
        vaultRoot,
        outDir,
        now: new Date("2026-11-10T00:00:00.000Z"),
      });
      expect(result.manifest.gitSha).toBe("unknown");
    } finally {
      process.chdir(prevCwd);
    }
  });
});
