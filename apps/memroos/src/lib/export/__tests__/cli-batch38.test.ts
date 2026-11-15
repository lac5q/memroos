// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as dsarExport from "@/lib/export/dsar-export";
import { runMemroosCli } from "@/lib/export/cli";

const memDb = new Database(":memory:");

vi.mock("@/lib/db", () => ({
  getDb: () => memDb,
  closeDb: vi.fn(),
}));

describe("export cli batch38 — catch paths", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("runMemroosCli catch returns 1 when exportDsarPackage throws (137–139)", async () => {
    vi.spyOn(dsarExport, "exportDsarPackage").mockImplementation(() => {
      throw new Error("dsar boom batch38");
    });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const code = await runMemroosCli([
      "node",
      "memroos",
      "export",
      "--dsar",
      "--user",
      `user-b38-${Date.now()}`,
      "--tenant",
      "tenant-b38",
    ]);
    expect(code).toBe(1);
    expect(err.mock.calls.some((c) => String(c[0]).includes("dsar boom batch38"))).toBe(true);
  });

  it("runMemroosCli catch returns 1 when deleteDsarUser throws (137–139)", async () => {
    vi.spyOn(dsarExport, "deleteDsarUser").mockImplementation(() => {
      throw new Error("delete boom batch38");
    });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const code = await runMemroosCli([
      "node",
      "memroos",
      "delete",
      "--user",
      `user-del-b38-${Date.now()}`,
    ]);
    expect(code).toBe(1);
    expect(err.mock.calls.some((c) => String(c[0]).includes("delete boom batch38"))).toBe(true);
  });

  it.skip("isDirect argv guard (143–149) — covered by batch37 dynamic import", () => {});
});