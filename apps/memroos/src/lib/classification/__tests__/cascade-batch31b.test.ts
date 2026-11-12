// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { classifyText, classifyVaultArtifact } from "../cascade";

afterEach(() => {
  // per-test db.close()
});

describe("classification cascade batch31b — chunk filter and missing artifact", () => {
  it("scanForClassification drops input_too_long matches in chunked scans (line 272)", () => {
    const body = `${"alpha ".repeat(1200)}sk-live=${"9".repeat(12)}`;
    const result = classifyText({
      content: body,
      sourceType: "message",
      metadata: {},
    });
    expect(result.reasonCodes.some((code) => code.includes("input_too_long"))).toBe(false);
    expect(result.reasonCodes.length).toBeGreaterThan(0);
  });

  it("classifyVaultArtifact throws when artifact id is unknown (line 349)", () => {
    const db = new Database(":memory:");
    initSchema(db);
    expect(() => classifyVaultArtifact(db, `missing-art-${randomUUID()}`)).toThrow(/Vault artifact not found/);
    db.close();
  });
});
