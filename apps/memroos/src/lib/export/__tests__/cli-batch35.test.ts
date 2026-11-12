// @vitest-environment node
import { describe, expect, it } from "vitest";

import { runMemroosCli } from "@/lib/export/cli";

describe("export cli batch35", () => {
  it("runMemroosCli returns 2 for unknown commands", async () => {
    const code = await runMemroosCli(["node", "memroos", "batch35-unknown"]);
    expect(code).toBe(2);
  });

  it.skip("isDirect auto-exit path (148) — importing cli would terminate the vitest process", () => {});
});
