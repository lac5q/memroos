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

describe("auth/session batch38 — API key DB throw catch", () => {
  afterEach(() => {
    mockVerifyAccessToken.mockReset();
    delete process.env.SQLITE_DB_PATH;
    vi.resetModules();
    vi.doUnmock("@/lib/db");
  });

  it("returns null when getDb throws during API key path (89)", async () => {
    const dbPath = path.join(os.tmpdir(), `session-b38-${randomUUID()}.db`);
    process.env.SQLITE_DB_PATH = dbPath;
    vi.resetModules();
    const dbMod = await import("@/lib/db");
    const db = dbMod.getDb();
    initSchema(db);
    const userId = `user-b38-${randomUUID().slice(0, 8)}`;
    const token = `memroos-key-b38-${randomUUID()}`;
    const keyHash = createHash("sha256").update(token).digest("hex");
    db.prepare(
      `INSERT INTO users (id, email, display_name, password_hash, tenant_id, created_at)
       VALUES (?, 'b38@localhost', 'B38', 'hash', 'default-tenant', datetime('now'))`,
    ).run(userId);
    db.prepare(
      `INSERT INTO user_api_keys (user_id, key_hash, label, created_at)
       VALUES (?, ?, 'b38', datetime('now'))`,
    ).run(userId, keyHash);
    dbMod.closeDb();

    vi.doMock("@/lib/db", () => ({
      getDb: () => {
        throw new Error("db unavailable batch38");
      },
      closeDb: vi.fn(),
    }));
    vi.resetModules();

    const { authenticateUser } = await import("@/lib/auth/session");
    const res = await authenticateUser(
      new Request("http://localhost:3000/api/b38", {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(res).toBeNull();
    fs.rmSync(dbPath, { force: true });
  });
});