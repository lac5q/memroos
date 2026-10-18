// @vitest-environment node
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initSchema } from "@/lib/db-schema";

const testDb = new Database(":memory:");
initSchema(testDb);

const authenticateUser = vi.hoisted(() => vi.fn());
const exportDsarPackage = vi.hoisted(() =>
  vi.fn(() => ({
    archivePath: "/tmp/dsar-export.tgz",
    manifestPath: "/tmp/dsar-manifest.json",
    fileCount: 1,
    auditEntryCount: 2,
  }))
);

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("@/lib/auth/session", () => ({
  authenticateUser: (...args: unknown[]) => authenticateUser(...args),
}));

vi.mock("@/lib/export/dsar-export", () => ({
  exportDsarPackage: (...args: unknown[]) => exportDsarPackage(...args),
}));

vi.mock("fs", () => ({
  default: {
    mkdtempSync: vi.fn(() => "/tmp/dsar-api"),
    readFileSync: vi.fn((p: string) => (String(p).endsWith(".json") ? "{}" : Buffer.from("archive"))),
    rmSync: vi.fn(),
  },
}));

const { POST } = await import("../route");

describe("POST /api/dsar/export", () => {
  beforeEach(() => {
    authenticateUser.mockReset();
  });

  it("returns 401/403 without admin session", async () => {
    authenticateUser.mockResolvedValueOnce(null);
    const res = await POST(
      new Request("http://localhost/api/dsar/export", {
        method: "POST",
        body: JSON.stringify({ userId: "target-user" }),
      }) as never
    );
    expect([401, 403]).toContain(res.status);
  });

  it("returns 400 for invalid JSON and validation errors", async () => {
    authenticateUser.mockResolvedValueOnce({
      userId: "admin",
      role: "admin",
      email: "admin@example.com",
      displayName: "Admin",
      tenantId: "default-tenant",
    });
    expect(
      (
        await POST(
          new Request("http://localhost/api/dsar/export", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{",
          }) as never
        )
      ).status
    ).toBe(400);

    authenticateUser.mockResolvedValueOnce({
      userId: "admin",
      role: "admin",
      email: "admin@example.com",
      displayName: "Admin",
      tenantId: "default-tenant",
    });
    expect(
      (
        await POST(
          new Request("http://localhost/api/dsar/export", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId: "" }),
          }) as never
        )
      ).status
    ).toBe(400);
  });

  it("returns 500 when export fails", async () => {
    authenticateUser.mockResolvedValueOnce({
      userId: "admin",
      role: "admin",
      email: "admin@example.com",
      displayName: "Admin",
      tenantId: "default-tenant",
    });
    exportDsarPackage.mockImplementationOnce(() => {
      throw new Error("export failed");
    });
    const res = await POST(
      new Request("http://localhost/api/dsar/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "user-123" }),
      }) as never
    );
    expect(res.status).toBe(500);
  });

  it("returns attachment for valid admin export", async () => {
    authenticateUser.mockResolvedValueOnce({
      userId: "admin",
      role: "admin",
      email: "admin@example.com",
      displayName: "Admin",
      tenantId: "default-tenant",
    });
    const res = await POST(
      new Request("http://localhost/api/dsar/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "user-123" }),
      }) as never
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toContain("attachment");
  });
});
