// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

const TEST_DB_DIR = path.join(os.tmpdir(), `invite-b36b-${randomUUID()}`);
const TEST_DB_PATH = path.join(TEST_DB_DIR, "invite.db");

async function loadInviteRoute() {
  process.env.SQLITE_DB_PATH = TEST_DB_PATH;
  process.env.MEMROOS_OPERATOR_API_KEY = "operator-secret-b36b";
  vi.resetModules();
  return import("../route");
}

describe("onboarding invite route batch36b", () => {
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
    vi.restoreAllMocks();
  });

  it("json().catch tolerates malformed invite bodies (49)", async () => {
    const { POST } = await loadInviteRoute();
    const res = await POST(
      new Request("http://localhost/api/onboarding/invite", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-memroos-operator-key": "operator-secret-b36b",
        },
        body: "{bad-json-b36b",
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBeTruthy();
  });
});
