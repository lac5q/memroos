// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DB_DIR = path.join(os.tmpdir(), `invite-b34b-${crypto.randomUUID()}`);
const TEST_DB_PATH = path.join(TEST_DB_DIR, "invite.db");

async function loadInviteRoute() {
  process.env.SQLITE_DB_PATH = TEST_DB_PATH;
  process.env.MEMROOS_OPERATOR_API_KEY = "operator-secret-b34b";
  process.env.MEMROOS_ONBOARDING_SECRET = "onboarding-secret-b34b";
  vi.resetModules();
  return import("../route");
}

describe("onboarding invite route batch34b", () => {
  beforeEach(() => {
    fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
    fs.mkdirSync(TEST_DB_DIR, { recursive: true });
  });

  afterEach(async () => {
    const { closeDb } = await import("@/lib/db");
    closeDb();
    fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
    delete process.env.SQLITE_DB_PATH;
    delete process.env.MEMROOS_OPERATOR_API_KEY;
    delete process.env.MEMROOS_ONBOARDING_SECRET;
    vi.restoreAllMocks();
    vi.doUnmock("@/lib/agent-onboarding");
  });

  it("uses forwarded host for origin when present (lines 21–22)", async () => {
    const { POST } = await loadInviteRoute();
    const res = await POST(
      new Request("http://localhost/api/onboarding/invite", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-memroos-operator-key": "operator-secret-b34b",
          "x-forwarded-host": "memroos.local",
          "x-forwarded-proto": "https",
        },
        body: JSON.stringify({ platform: "codex" }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.command).toContain("https://memroos.local/api/onboarding/script");
  });

  it("ignores invalid platform and keeps default protocol rest (lines 32–33, 58–60)", async () => {
    const { POST } = await loadInviteRoute();
    const res = await POST(
      new Request("http://localhost/api/onboarding/invite", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-memroos-operator-key": "operator-secret-b34b",
        },
        body: JSON.stringify({ platform: "not-a-platform", protocol: "not-valid" }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.command).not.toContain("--platform");
  });

  it("treats non-object JSON bodies as empty input (lines 50–51)", async () => {
    const { POST } = await loadInviteRoute();
    const res = await POST(
      new Request("http://localhost/api/onboarding/invite", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-memroos-operator-key": "operator-secret-b34b",
        },
        body: JSON.stringify(null),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.command).toContain("/api/onboarding/script?token=");
  });

  it("returns 500 with stringified error for non-Error throws (line 96)", async () => {
    vi.doMock("@/lib/agent-onboarding", async () => {
      const actual = await vi.importActual<typeof import("@/lib/agent-onboarding")>(
        "@/lib/agent-onboarding",
      );
      return {
        ...actual,
        createAgentOnboardingToken: () => {
          throw "mint-string-failure";
        },
      };
    });
    const { POST } = await loadInviteRoute();
    const res = await POST(
      new Request("http://localhost/api/onboarding/invite", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-memroos-operator-key": "operator-secret-b34b",
        },
        body: JSON.stringify({ platform: "codex" }),
      }),
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Internal server error");
  });
});
