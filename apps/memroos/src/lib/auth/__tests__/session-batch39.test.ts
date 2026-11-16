// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";

const mockVerifyAccessToken = vi.fn();

vi.mock("@/lib/auth/jwt", () => ({
  verifyAccessToken: (...args: unknown[]) => mockVerifyAccessToken(...args),
}));

describe("auth/session batch39", () => {
  afterEach(() => {
    mockVerifyAccessToken.mockReset();
    delete process.env.SQLITE_DB_PATH;
    vi.resetModules();
    vi.doUnmock("@/lib/db");
  });

  it("defaults API key user role to reviewer when user_roles row is missing (83)", async () => {
    const dbPath = path.join(os.tmpdir(), `session-b39-${randomUUID()}.db`);
    process.env.SQLITE_DB_PATH = dbPath;
    vi.resetModules();
    const dbMod = await import("@/lib/db");
    const db = dbMod.getDb();
    initSchema(db);
    const userId = `user-b39-${randomUUID().slice(0, 8)}`;
    const token = `memroos-key-b39-${randomUUID()}`;
    const keyHash = createHash("sha256").update(token).digest("hex");
    db.prepare(
      `INSERT INTO users (id, email, display_name, password_hash, tenant_id, created_at)
       VALUES (?, 'b39@localhost', 'B39', 'hash', 'default-tenant', datetime('now'))`,
    ).run(userId);
    db.prepare(
      `INSERT INTO user_api_keys (user_id, key_hash, label, created_at)
       VALUES (?, ?, 'b39', datetime('now'))`,
    ).run(userId, keyHash);
    dbMod.closeDb();

    const { authenticateUser } = await import("@/lib/auth/session");
    const res = await authenticateUser(
      new Request("http://localhost:3000/api/b39-reviewer-default", {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(res).toMatchObject({
      userId,
      role: "reviewer",
      email: "b39@localhost",
      tenantId: "default-tenant",
    });

    fs.rmSync(dbPath, { force: true });
  });

  it("returns null when Authorization header is present but not Bearer unless cookie provides token", async () => {
    mockVerifyAccessToken.mockResolvedValue(null);
    const { authenticateUser } = await import("@/lib/auth/session");

    const noBearer = await authenticateUser(
      new Request("http://localhost:3000/api/b39-basic", {
        headers: { authorization: "Basic not-bearer" },
      }),
    );
    expect(noBearer).toBeNull();

    mockVerifyAccessToken.mockResolvedValueOnce({
      sub: "user-cookie-b39",
      role: "operator",
    });
    const cookieJwt = await authenticateUser(
      new Request("http://localhost:3000/api/b39-cookie-jwt", {
        headers: {
          authorization: "Token eyJhbG.a.b",
          cookie: "access_token=eyJhbG.JWT.payload",
        },
      }),
    );
    expect(cookieJwt).toMatchObject({
      userId: "user-cookie-b39",
      role: "operator",
    });
    expect(mockVerifyAccessToken).toHaveBeenCalledWith("eyJhbG.JWT.payload");
  });

  it("authenticates via access_token cookie with valid JWT", async () => {
    mockVerifyAccessToken.mockResolvedValueOnce({
      sub: `user-jwt-b39-${randomUUID().slice(0, 6)}`,
      role: "admin",
    });
    const { authenticateUser } = await import("@/lib/auth/session");
    const jwtToken = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.sig";
    const res = await authenticateUser(
      new Request("http://localhost:3000/api/b39-cookie-only", {
        headers: { cookie: `access_token=${encodeURIComponent(jwtToken)}` },
      }),
    );
    expect(res?.role).toBe("admin");
    expect(mockVerifyAccessToken).toHaveBeenCalledWith(jwtToken);
  });
});