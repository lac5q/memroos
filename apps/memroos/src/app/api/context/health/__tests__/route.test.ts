// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({
  authenticateUser: vi.fn(),
}));

vi.mock("@/lib/context-sources", () => ({
  loadContextSourceContracts: vi.fn(() => [{ id: "wiki", kind: "vault" }]),
  evaluateContextSources: vi.fn(() => ({ ok: true, sources: [{ id: "wiki", status: "live" }] })),
}));

import { authenticateUser } from "@/lib/auth/session";
import { evaluateContextSources } from "@/lib/context-sources";
import { GET } from "../route";

describe("GET /api/context/health", () => {
  it("401 without session", async () => {
    vi.mocked(authenticateUser).mockResolvedValueOnce(null);
    const res = await GET(new Request("http://localhost/api/context/health") as never);
    expect(res.status).toBe(401);
  });

  it("returns evaluated context source health", async () => {
    vi.mocked(authenticateUser).mockResolvedValueOnce({
      userId: "u1",
      role: "operator",
      email: "",
      displayName: "",
      tenantId: "default",
    });
    const res = await GET(new Request("http://localhost/api/context/health") as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, sources: [{ id: "wiki", status: "live" }] });
    expect(evaluateContextSources).toHaveBeenCalled();
  });
});
