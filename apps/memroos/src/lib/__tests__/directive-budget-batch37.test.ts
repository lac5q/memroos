// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

import { loadDirectiveBudgetConfig } from "@/lib/directive-budget";

const TMP = path.join(os.tmpdir(), `directive-budget-b37-${randomUUID()}`);

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe("directive-budget batch37 — readStore malformed tenants (139)", () => {
  it("loadDirectiveBudgetConfig returns default when store JSON lacks tenants", () => {
    fs.mkdirSync(TMP, { recursive: true });
    const storePath = path.join(TMP, "apps", "memroos", "data", "directive-budgets.json");
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(storePath, JSON.stringify({ version: 1 }), "utf8");
    vi.stubEnv("MEMROOS_ROOT", TMP);
    expect(loadDirectiveBudgetConfig().budgetLines).toBe(200);
  });
});