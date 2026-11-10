// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initSchema } from "@/lib/db-schema";
import { seedDefaultAdmin } from "../seed";

describe("seedDefaultAdmin", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
  });

  afterEach(() => {
    db.close();
    delete process.env.MEMROOS_ADMIN_EMAIL;
    delete process.env.MEMROOS_ADMIN_PASSWORD;
    vi.restoreAllMocks();
  });

  it("skips seeding when users already exist", () => {
    db.prepare("INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)").run(
      "u1",
      "existing@memroos.test.local",
      "existing",
      "hash",
      new Date().toISOString()
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    seedDefaultAdmin(db);
    expect(warnSpy).not.toHaveBeenCalled();
    expect((db.prepare("SELECT COUNT(*) as cnt FROM users").get() as { cnt: number }).cnt).toBe(1);
  });

  it("warns when admin env vars are missing on an empty database", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    seedDefaultAdmin(db);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("MEMROOS_ADMIN_EMAIL"));
    expect((db.prepare("SELECT COUNT(*) as cnt FROM users").get() as { cnt: number }).cnt).toBe(0);
  });

  it("creates the default admin when env vars are configured", () => {
    process.env.MEMROOS_ADMIN_EMAIL = "admin@memroos.test.local";
    process.env.MEMROOS_ADMIN_PASSWORD = "seed-password";
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    seedDefaultAdmin(db);
    expect(infoSpy).toHaveBeenCalledWith("[Memroos] Admin user created: admin@memroos.test.local");
    const row = db.prepare("SELECT email FROM users").get() as { email: string };
    expect(row.email).toBe("admin@memroos.test.local");
  });
});
