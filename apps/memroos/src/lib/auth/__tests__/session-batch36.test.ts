// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";

const mockVerifyAccessToken = vi.fn();

vi.mock("@/lib/auth/jwt", () => ({
  verifyAccessToken: (...args: unknown[]) => mockVerifyAccessToken(...args),
}));

describe("auth/session batch36", () => {
  afterEach(() => {
    mockVerifyAccessToken.mockReset();
    delete process.env.SQLITE_DB_PATH;
    vi.resetModules();
  });

  it("returns null when API key resolves but user row is gone (68)", async () => {
    const dbPath = path.join(os.tmpdir(), `session-b36-orphan-${randomUUID()}.db`);
    process.env.SQLITE_DB_PATH = dbPath;
    vi.resetModules();
    const dbMod = await import("@/lib/db");
    const db = dbMod.getDb();
    initSchema(db);
    const ghostUserId = `ghost-b36-${randomUUID().slice(0, 8)}`;
    const token = `memroos-key-b36-${randomUUID()}`;
    const keyHash = createHash("sha256").update(token).digest("hex");
    db.prepare(
      `INSERT INTO users (id, email, display_name, password_hash, tenant_id, created_at)
       VALUES (?, 'ghost-b36@localhost', 'Ghost', 'hash', 'default-tenant', datetime('now'))`,
    ).run(ghostUserId);
    db.prepare(
      `INSERT INTO user_api_keys (user_id, key_hash, label, created_at)
       VALUES (?, ?, 'ghost-b36', datetime('now'))`,
    ).run(ghostUserId, keyHash);
    db.prepare(`DELETE FROM users WHERE id = ?`).run(ghostUserId);

    const { authenticateUser } = await import("@/lib/auth/session");
    const res = await authenticateUser(
      new Request("http://localhost:3000/api/b36", {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(res).toBeNull();
    dbMod.closeDb();
    fs.rmSync(dbPath, { force: true });
  });

  it("returns null when API key database lookup throws (89)", async () => {
    const missingDb = path.join(os.tmpdir(), `session-b36-missing-${randomUUID()}`, "nested", "db.sqlite");
    process.env.SQLITE_DB_PATH = missingDb;
    vi.resetModules();
    const { authenticateUser } = await import("@/lib/auth/session");
    const token = `plain-api-key-b36-${randomUUID()}`;
    const res = await authenticateUser(
      new Request("http://localhost:3000/api/b36", {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(res).toBeNull();
  });
});
