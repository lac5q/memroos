// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";

import { closeDb } from "@/lib/db";
import { GET as auditGet } from "../audit/route";
import { POST as consolidationPost } from "../consolidation/route";
import { POST as decayPost } from "../decay/route";
import { POST as dsarPost } from "../dsar/route";
import { POST as expiryPost } from "../expiry/route";
import { POST as graphCatchupPost } from "../graph-catchup/route";
import { POST as legalHoldsPost } from "../legal-holds/route";
import { POST as offboardingPost } from "../offboarding/route";
import { POST as retentionPost } from "../retention/route";
import { POST as subjectErasurePost } from "../subject-erasure/route";
import { GET as tombstonesGet, POST as tombstonesPost } from "../tombstones/route";
import { GET as vaultGet, POST as vaultPost } from "../vault/route";

const PUBLIC = "https://memroos.example.com";

function publicRequest(path: string, init?: RequestInit): Request {
  return new Request(`${PUBLIC}${path}`, init);
}

afterEach(() => {
  closeDb();
});

describe("memory lifecycle registry auth", () => {
  it.each([
    ["GET /audit", () => auditGet(publicRequest("/api/memory-lifecycle/audit"))],
    [
      "POST /consolidation",
      () =>
        consolidationPost(
          publicRequest("/api/memory-lifecycle/consolidation", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}",
          })
        ),
    ],
    [
      "POST /decay",
      () =>
        decayPost(
          publicRequest("/api/memory-lifecycle/decay", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}",
          })
        ),
    ],
    [
      "POST /dsar",
      () =>
        dsarPost(
          publicRequest("/api/memory-lifecycle/dsar", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}",
          })
        ),
    ],
    [
      "POST /expiry",
      () =>
        expiryPost(
          publicRequest("/api/memory-lifecycle/expiry", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}",
          })
        ),
    ],
    [
      "POST /graph-catchup",
      () =>
        graphCatchupPost(
          publicRequest("/api/memory-lifecycle/graph-catchup", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}",
          })
        ),
    ],
    [
      "POST /legal-holds",
      () =>
        legalHoldsPost(
          publicRequest("/api/memory-lifecycle/legal-holds", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}",
          })
        ),
    ],
    [
      "POST /retention",
      () =>
        retentionPost(
          publicRequest("/api/memory-lifecycle/retention", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}",
          })
        ),
    ],
    [
      "POST /subject-erasure",
      () =>
        subjectErasurePost(
          publicRequest("/api/memory-lifecycle/subject-erasure", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}",
          })
        ),
    ],
    [
      "POST /offboarding",
      () =>
        offboardingPost(
          publicRequest("/api/memory-lifecycle/offboarding", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}",
          })
        ),
    ],
    ["GET /tombstones", () => tombstonesGet(publicRequest("/api/memory-lifecycle/tombstones"))],
    [
      "POST /tombstones",
      () =>
        tombstonesPost(
          publicRequest("/api/memory-lifecycle/tombstones", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}",
          })
        ),
    ],
    ["GET /vault", () => vaultGet(publicRequest("/api/memory-lifecycle/vault"))],
    [
      "POST /vault",
      () =>
        vaultPost(
          publicRequest("/api/memory-lifecycle/vault", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}",
          })
        ),
    ],
  ])("%s requires registry write authorization off localhost", async (_label, invoke) => {
    const res = await invoke();
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      ok: false,
      error: "Registry write authorization required",
    });
  });
});
