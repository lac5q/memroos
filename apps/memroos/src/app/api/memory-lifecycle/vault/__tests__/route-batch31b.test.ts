// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TMP_ROOT = path.join(os.tmpdir(), `vault-route-b31b-${randomUUID()}`);

vi.mock("@/lib/operator-auth", () => ({
  authorizeRegistryWrite: () => true,
  registryWriteUnauthorizedResponse: () => new Response("{}", { status: 401 }),
}));

beforeEach(async () => {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  process.env.SQLITE_DB_PATH = path.join(TMP_ROOT, `${randomUUID()}.db`);
  vi.stubEnv("MEMROOS_VAULT_ROOT", path.join(TMP_ROOT, "vault"));
  const { closeDb } = await import("@/lib/db");
  closeDb();
});

afterEach(async () => {
  const { closeDb } = await import("@/lib/db");
  closeDb();
  delete process.env.SQLITE_DB_PATH;
  vi.unstubAllEnvs();
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
});

describe("memory-lifecycle vault route batch31b", () => {
  it("asLabel returns empty label for non-object values (line 29)", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      new Request("http://localhost/api/memory-lifecycle/vault", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "write",
          actorId: "operator-b31b",
          sourceType: "message",
          body: "vault batch31b payload",
          label: "not-an-object",
        }),
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.artifact).toBeTruthy();
  });

  it("GET returns 400 when artifact lookup fails (line 107)", async () => {
    const { GET } = await import("../route");
    const res = await GET(
      new Request(
        `http://localhost/api/memory-lifecycle/vault?tenantId=default-tenant&artifactId=missing-${randomUUID()}`,
      ),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.ok).toBe(false);
  });
});
