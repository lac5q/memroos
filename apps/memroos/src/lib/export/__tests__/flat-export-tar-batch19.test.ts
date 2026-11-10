// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return {
    ...actual,
    spawnSync: ((command: string, args?: readonly string[], options?: import("child_process").SpawnSyncOptions) => {
      if (command === "tar") {
        return {
          status: 1,
          stdout: "",
          stderr: "tar exploded",
          pid: 0,
          signal: null,
          output: ["", "tar exploded"],
          error: undefined,
        } as ReturnType<typeof actual.spawnSync>;
      }
      return actual.spawnSync(command, args, options);
    }) as typeof actual.spawnSync,
  };
});

import { exportFlatVault } from "../flat-export";

const ROOT = path.join(os.tmpdir(), `flat-tar-b19-${process.pid}`);

afterEach(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
});

describe("flat-export tar failures batch19", () => {
  it("exportFlatVault throws when tar archive creation fails", () => {
    const tenantId = "tenant-tar-b19";
    const vaultRoot = path.join(ROOT, "vaults");
    fs.mkdirSync(path.join(vaultRoot, tenantId), { recursive: true });
    fs.writeFileSync(path.join(vaultRoot, tenantId, "note.md"), "# tar fail\n", "utf8");
    expect(() =>
      exportFlatVault({
        tenantId,
        vaultRoot,
        outDir: path.join(ROOT, "out"),
        signingKey: "sign-b19",
        gitSha: "sha-b19",
      }),
    ).toThrow(/tar failed/);
  });
});
