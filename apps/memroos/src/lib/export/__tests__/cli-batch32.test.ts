// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

import { runMemroosCli } from "@/lib/export/cli";

describe("export cli batch32 — runMemroosCli unknown command", () => {
  it("runMemroosCli returns 2 for unknown commands without throwing", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const code = await runMemroosCli([
      "node",
      "memroos",
      `unknown-b32-${randomUUID().slice(0, 6)}`,
    ]);
    expect(code).toBe(2);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  // sticky: isDirect auto-exit block (148-149) only runs as process entrypoint.
  it.skip("isDirect auto-exit block requires CLI subprocess", () => {});
});
