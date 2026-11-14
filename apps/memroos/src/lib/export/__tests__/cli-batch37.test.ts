// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import * as flatExport from "@/lib/export/flat-export";
import { runMemroosCli } from "@/lib/export/cli";

describe("export cli batch37", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("runMemroosCli catch path returns 1 when exportFlatVault throws (137-139)", async () => {
    vi.spyOn(flatExport, "exportFlatVault").mockImplementation(() => {
      throw new Error("vault unavailable batch37");
    });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const code = await runMemroosCli([
      "node",
      "memroos",
      "export",
      "--flat",
      "--tenant",
      "tenant-b37",
    ]);
    expect(code).toBe(1);
    expect(err.mock.calls.some((c) => String(c[0]).includes("vault unavailable batch37"))).toBe(true);
  });

  it("direct cli entry invokes process.exit with runMemroosCli result (148-149)", async () => {
    vi.resetModules();
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as typeof process.exit);
    const argv = [...process.argv];
    process.argv = ["node", "src/lib/export/cli", "--help"];
    await import("@/lib/export/cli");
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0), { timeout: 3000 });
    process.argv = argv;
  });
});