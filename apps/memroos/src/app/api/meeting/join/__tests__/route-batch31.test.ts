// @vitest-environment node
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

import { initSchema } from "@/lib/db-schema";

let testDb: Database.Database;
let sessionRole: "admin" | "operator" | "reviewer" | null = "operator";
let consentOk = true;

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
}));

vi.mock("@/lib/auth/session", () => ({
  authenticateUser: async () =>
    sessionRole
      ? {
          userId: `operator-b31-${randomUUID().slice(0, 8)}`,
          role: sessionRole,
          email: "operator-b31@localhost",
          displayName: "Operator B31",
          tenantId: "default-tenant",
        }
      : null,
}));

vi.mock("@/lib/voice/meeting-consent", () => ({
  recordConsent: vi.fn(() => `meeting-b31-${randomUUID().slice(0, 8)}`),
  hasConsent: vi.fn(() => consentOk),
}));

function makeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost:3000/api/meeting/join", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  testDb?.close();
  testDb = new Database(":memory:");
  initSchema(testDb);
  sessionRole = "operator";
  consentOk = true;
  vi.clearAllMocks();
});

describe("POST /api/meeting/join batch31", () => {
  it("returns 403 when role is below operator (line 21)", async () => {
    sessionRole = "reviewer";
    const { POST } = await import("../route");
    const res = await POST(
      makeRequest({
        meetingLabel: "Sync",
        roomUrl: "https://daily.example/room-b31",
        token: "token-b31",
        consentConfirmed: true,
      }) as never,
    );
    expect(res.status).toBe(403);
  });

  it("returns 400 when roomUrl or token missing (line 37)", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      makeRequest({
        meetingLabel: "Sync",
        roomUrl: " ",
        token: "token-b31",
        consentConfirmed: true,
      }) as never,
    );
    expect(res.status).toBe(400);
  });

  it("returns 403 when consent record fails verification (line 47)", async () => {
    consentOk = false;
    const { POST } = await import("../route");
    const res = await POST(
      makeRequest({
        meetingLabel: "Sync",
        roomUrl: "https://daily.example/room-b31",
        token: "token-b31",
        consentConfirmed: true,
      }) as never,
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "recording consent required" });
  });
});
