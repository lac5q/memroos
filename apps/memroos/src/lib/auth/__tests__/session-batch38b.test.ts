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

describe("auth/session batch38b", () => {
  afterEach(() => {
    mockVerifyAccessToken.mockReset();
    delete process.env.SQLITE_DB_PATH;
    vi.resetModules();
    vi.doUnmock("@/lib/db");
  });

  it("returns null when API key row has no matching user (68)", async () => {
    const ghostUserId = `ghost-${randomUUID()}`;
    const token = `memroos-key-b38b-${randomUUID()}`;
    const keyHash = createHash("sha256").update(token).digest("hex");
    vi.doMock("@/lib/db", () => ({
      getDb: () => ({
        prepare: (sql: string) => ({
          get: () => {
            if (sql.includes("user_api_keys")) {
              return { user_id: ghostUserId, revoked_at: null };
            }
            if (sql.includes("FROM users")) {
              return undefined;
            }
            return undefined;
          },
          run: vi.fn(),
        }),
      }),
      closeDb: vi.fn(),
    }));
    vi.resetModules();

    const { authenticateUser } = await import("@/lib/auth/session");
    const res = await authenticateUser(
      new Request("http://localhost:3000/api/b38b-orphan", {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(res).toBeNull();
    expect(keyHash).toHaveLength(64);
  });

  it("returns null when getDb throws during API key auth (89)", async () => {
    const dbPath = path.join(os.tmpdir(), `session-b38b-db-${randomUUID()}.db`);
    process.env.SQLITE_DB_PATH = dbPath;
    vi.resetModules();
    const dbMod = await import("@/lib/db");
    const db = dbMod.getDb();
    initSchema(db);
    const userId = `user-b38b-${randomUUID().slice(0, 8)}`;
    const token = `memroos-key-b38b-throw-${randomUUID()}`;
    const keyHash = createHash("sha256").update(token).digest("hex");
    db.prepare(
      `INSERT INTO users (id, email, display_name, password_hash, tenant_id, created_at)
       VALUES (?, 'b38b@localhost', 'B38b', 'hash', 'default-tenant', datetime('now'))`,
    ).run(userId);
    db.prepare(
      `INSERT INTO user_api_keys (user_id, key_hash, label, created_at)
       VALUES (?, ?, 'b38b', datetime('now'))`,
    ).run(userId, keyHash);
    dbMod.closeDb();

    vi.doMock("@/lib/db", () => ({
      getDb: () => {
        throw new Error("db unavailable batch38b");
      },
      closeDb: vi.fn(),
    }));
    vi.resetModules();

    const { authenticateUser } = await import("@/lib/auth/session");
    const res = await authenticateUser(
      new Request("http://localhost:3000/api/b38b", {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(res).toBeNull();
    fs.rmSync(dbPath, { force: true });
  });
});