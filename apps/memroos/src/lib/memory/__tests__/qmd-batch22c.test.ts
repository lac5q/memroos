// @vitest-environment node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { getDb, closeDb } from "@/lib/db";
import { finalizeQmdUpdate, serializeQmdUpdate } from "@/lib/memory/qmd";

describe("memory/qmd batch22c", () => {
  let tmp: string;

  afterEach(() => {
    closeDb();
    delete process.env.SQLITE_DB_PATH;
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("serialize and finalize QMD update round-trip", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), `qmd-b22c-${crypto.randomUUID()}-`));
    process.env.SQLITE_DB_PATH = path.join(tmp, "qmd.db");
    const db = getDb();
    initSchema(db);

    const pending = serializeQmdUpdate(db, "docs/readme.md", "hello batch22c", new Date("2026-07-01T00:00:00.000Z"));
    expect(pending.status).toBe("pending");

    const done = finalizeQmdUpdate(db, pending.id, "success", new Date("2026-07-01T01:00:00.000Z"));
    expect(done.status).toBe("success");
    expect(done.lastSuccessTimestamp).toBe("2026-07-01T01:00:00.000Z");
  });

  it("finalizeQmdUpdate records failed outcome", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), `qmd-b22c-fail-${crypto.randomUUID()}-`));
    process.env.SQLITE_DB_PATH = path.join(tmp, "qmd-fail.db");
    const db = getDb();
    initSchema(db);
    const pending = serializeQmdUpdate(db, "docs/fail.md", "content batch22c");
    const failed = finalizeQmdUpdate(db, pending.id, "failed");
    expect(failed.status).toBe("failed");
    expect(failed.lastSuccessTimestamp).toBeUndefined();
  });
});
