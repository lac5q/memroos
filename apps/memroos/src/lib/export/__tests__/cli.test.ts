// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";

vi.mock("@/lib/export/flat-export", () => ({
  exportFlatVault: vi.fn(() => ({
    archivePath: "/tmp/flat.tgz",
    manifestPath: "/tmp/manifest.json",
    manifest: {
      treeHash: "abc123",
      fileCount: 2,
      signatureAlg: "hmac-sha256",
    },
  })),
}));

vi.mock("@/lib/export/dsar-export", () => ({
  exportDsarPackage: vi.fn(() => ({
    archivePath: "/tmp/dsar.tgz",
    manifestPath: "/tmp/dsar-manifest.json",
    fileCount: 1,
    auditEntryCount: 3,
  })),
  deleteDsarUser: vi.fn(() => ({
    tombstones: 1,
    auditRowsPreserved: 5,
  })),
}));

vi.mock("@/lib/db", () => ({
  getDb: vi.fn(),
  closeDb: vi.fn(),
}));

import { deleteDsarUser, exportDsarPackage } from "@/lib/export/dsar-export";
import { exportFlatVault } from "@/lib/export/flat-export";
import { getDb, closeDb } from "@/lib/db";
import { runMemroosCli } from "@/lib/export/cli";

describe("export cli", () => {
  let db: Database.Database;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
    vi.mocked(getDb).mockReturnValue(db);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.clearAllMocks();
  });

  afterEach(() => {
    db.close();
    logSpy.mockRestore();
    errSpy.mockRestore();
  });

  it("prints help for empty argv", async () => {
    const code = await runMemroosCli(["node", "memroos"]);
    expect(code).toBe(0);
    expect(logSpy).toHaveBeenCalled();
  });

  it("runs export --flat", async () => {
    const code = await runMemroosCli([
      "node",
      "memroos",
      "export",
      "--flat",
      "--tenant",
      "t1",
    ]);
    expect(code).toBe(0);
    expect(exportFlatVault).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "t1" }),
    );
  });

  it("requires --user for export --dsar", async () => {
    const code = await runMemroosCli(["node", "memroos", "export", "--dsar"]);
    expect(code).toBe(2);
    expect(errSpy).toHaveBeenCalledWith("error: --user required for export --dsar");
  });

  it("runs export --dsar and closes db", async () => {
    const code = await runMemroosCli([
      "node",
      "memroos",
      "export",
      "--dsar",
      "--user",
      "user-1",
    ]);
    expect(code).toBe(0);
    expect(exportDsarPackage).toHaveBeenCalled();
    expect(closeDb).toHaveBeenCalled();
  });

  it("rejects export without --flat or --dsar and unknown commands", async () => {
    const exportOnly = await runMemroosCli(["node", "memroos", "export"]);
    expect(exportOnly).toBe(2);
    expect(errSpy).toHaveBeenCalledWith("error: export requires --flat or --dsar");

    const unknown = await runMemroosCli(["node", "memroos", "sync"]);
    expect(unknown).toBe(2);
    expect(errSpy).toHaveBeenCalledWith("error: unknown command: sync");
  });

  it("returns exit code 1 when the db layer throws", async () => {
    vi.mocked(getDb).mockImplementation(() => {
      throw new Error("db unavailable");
    });
    const code = await runMemroosCli([
      "node",
      "memroos",
      "delete",
      "--user",
      "user-3",
    ]);
    expect(code).toBe(1);
    expect(errSpy).toHaveBeenCalledWith("error: db unavailable");
  });

  it("runs delete --user", async () => {
    const code = await runMemroosCli([
      "node",
      "memroos",
      "delete",
      "--user",
      "user-2",
      "--by",
      "tester",
    ]);
    expect(code).toBe(0);
    expect(deleteDsarUser).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-2", tombstonedBy: "tester" }),
    );
  });
});
