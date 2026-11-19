// @vitest-environment node
import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";

import { runMemroosCli } from "@/lib/export/cli";

const memDb = new Database(":memory:");

vi.mock("@/lib/db", () => ({
  getDb: () => memDb,
  closeDb: vi.fn(),
}));

vi.mock("@/lib/export/dsar-export", () => ({
  exportDsarPackage: () => ({
    archivePath: "/tmp/dsar.zip",
    manifestPath: "/tmp/dsar-manifest.json",
    fileCount: 3,
    auditEntryCount: 1,
  }),
  deleteDsarUser: () => ({ tombstones: 2, auditRowsPreserved: 5 }),
}));

describe("export cli batch23b — dsar and delete happy paths", () => {
  it("returns 2 for export --dsar without --user", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const code = await runMemroosCli(["node", "memroos", "export", "--dsar", "--tenant", "t-dsar"]);
    expect(code).toBe(2);
    errSpy.mockRestore();
  });

  it("runs export --dsar and prints JSON summary", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const code = await runMemroosCli([
      "node",
      "memroos",
      "export",
      "--dsar",
      "--user",
      "user-42",
      "--tenant",
      "t-dsar",
    ]);
    expect(code).toBe(0);
    const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0]));
    expect(payload).toMatchObject({ ok: true, command: "export --dsar", fileCount: 3 });
    logSpy.mockRestore();
  });

  it("runs delete --user and prints tombstone summary", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const code = await runMemroosCli([
      "node",
      "memroos",
      "delete",
      "--user",
      "user-99",
      "--by",
      "cli:test",
    ]);
    expect(code).toBe(0);
    const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0]));
    expect(payload.tombstones).toBe(2);
    logSpy.mockRestore();
  });
});
