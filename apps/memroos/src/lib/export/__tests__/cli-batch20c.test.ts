// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { runMemroosCli } from "@/lib/export/cli";

vi.mock("@/lib/export/flat-export", () => ({
  exportFlatVault: () => ({
    archivePath: "/tmp/out.zip",
    manifestPath: "/tmp/manifest.json",
    manifest: { treeHash: "abc", fileCount: 1, signatureAlg: null },
  }),
}));

describe("export cli batch20c", () => {
  it("prints help and exits 0 for --help", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const code = await runMemroosCli(["node", "memroos", "--help"]);
    expect(code).toBe(0);
    expect(logSpy.mock.calls[0]?.[0]).toMatch(/Usage:/);
    logSpy.mockRestore();
  });

  it("returns 2 when export lacks --flat or --dsar", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const code = await runMemroosCli(["node", "memroos", "export"]);
    expect(code).toBe(2);
    errSpy.mockRestore();
  });

  it("runs export --flat and prints JSON summary", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const code = await runMemroosCli(["node", "memroos", "export", "--flat", "--tenant", "t1"]);
    expect(code).toBe(0);
    const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0]));
    expect(payload.ok).toBe(true);
    expect(payload.command).toBe("export --flat");
    logSpy.mockRestore();
  });

  it("returns 2 for delete without --user", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const code = await runMemroosCli(["node", "memroos", "delete"]);
    expect(code).toBe(2);
    errSpy.mockRestore();
  });
});
