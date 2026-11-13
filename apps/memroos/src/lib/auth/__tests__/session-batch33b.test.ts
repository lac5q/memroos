// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";

const mockVerifyAccessToken = vi.fn();

vi.mock("@/lib/auth/jwt", () => ({
  verifyAccessToken: (...args: unknown[]) => mockVerifyAccessToken(...args),
}));

describe("auth/session batch33b", () => {
  afterEach(() => {
    mockVerifyAccessToken.mockReset();
    delete process.env.SQLITE_DB_PATH;
    vi.resetModules();
  });

  it("returns null when API key user row is missing (68)", async () => {
    const dbPath = `/tmp/session-b33b-${randomUUID()}.db`;
    process.env.SQLITE_DB_PATH = dbPath;
    vi.resetModules();
    const dbMod = await import("@/lib/db");
    const db = dbMod.getDb();
    initSchema(db);
    const userId = `user-b33b-${randomUUID().slice(0, 8)}`;
    const token = `memroos-key-b33b-${randomUUID()}`;
    const keyHash = createHash("sha256").update(token).digest("hex");
    db.prepare(
      `INSERT INTO users (id, email, display_name, password_hash, tenant_id, created_at)
       VALUES (?, 'orphan-b33b@localhost', 'Orphan', 'hash', 'default-tenant', datetime('now'))`,
    ).run(userId);
    db.prepare(
      `INSERT INTO user_api_keys (user_id, key_hash, label, created_at)
       VALUES (?, ?, 'orphan', datetime('now'))`,
    ).run(userId, keyHash);
    db.prepare(`DELETE FROM users WHERE id = ?`).run(userId);

    const { authenticateUser } = await import("@/lib/auth/session");
    const res = await authenticateUser(
      new Request("http://localhost:3000/api/x", { headers: { authorization: `Bearer ${token}` } }),
    );
    expect(res).toBeNull();
    dbMod.closeDb();
  });

  it("returns null when database lookup throws (89)", async () => {
    process.env.SQLITE_DB_PATH = `/tmp/does-not-exist-b33b-${randomUUID()}/nested/db.sqlite`;
    vi.resetModules();
    const { authenticateUser } = await import("@/lib/auth/session");
    const token = `plain-api-key-b33b-${randomUUID()}`;
    const res = await authenticateUser(
      new Request("http://localhost:3000/api/x", { headers: { authorization: `Bearer ${token}` } }),
    );
    expect(res).toBeNull();
  });
});
