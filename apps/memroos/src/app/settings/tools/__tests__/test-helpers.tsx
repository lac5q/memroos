import type React from "react";
import { vi } from "vitest";
import { render, within, type Screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type {
  ConnectionActivityEvent,
  ListConnectionsResponse,
  ToolConnection,
} from "@/lib/tool-auth/types";

export function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { qc, ...render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>) };
}

export const DEFAULT_PROVIDERS_PAYLOAD = {
  providers: [{ key: "github", label: "GitHub", authMode: "oauth" }],
};

export function makeConnection(
  overrides: Partial<ToolConnection> & Pick<ToolConnection, "providerKey">,
): ToolConnection {
  return {
    connectionId: "conn-test-local-1",
    status: "connected",
    createdAt: "2026-01-01T00:00:00.000Z",
    authMode: "oauth",
    accountEmail: "ops@test.local",
    ...overrides,
  };
}

export type ToolsFetchOptions = {
  providers?: unknown | (() => unknown | Promise<unknown>);
  connections?: ListConnectionsResponse | (() => ListConnectionsResponse | Promise<ListConnectionsResponse>);
  activity?: { events: ConnectionActivityEvent[] } | (() => { events: ConnectionActivityEvent[] });
  usage?: unknown | (() => unknown | Promise<unknown>);
  delayProvidersMs?: number;
  oauthConnect?: (body: string) => Response | Promise<Response>;
  apiKeyConnect?: (body: string) => Response | Promise<Response>;
  disconnect?: (body: string) => Response | Promise<Response>;
  onFetch?: (url: string, init?: RequestInit) => void;
};

async function resolve<T>(value: T | (() => T | Promise<T>)): Promise<T> {
  if (typeof value === "function") {
    return await (value as () => T | Promise<T>)();
  }
  return value;
}

/** Find the provider card container for a registry label (e.g. GitHub). */
export function providerCard(screen: Screen, label: string): HTMLElement {
  const heading = screen.getByText(label, { exact: true });
  let node: HTMLElement | null = heading as HTMLElement;
  for (let depth = 0; depth < 10 && node; depth += 1) {
    const buttons = within(node).queryAllByRole("button");
    if (buttons.length > 0 && node.textContent?.includes(label)) {
      return node;
    }
    node = node.parentElement;
  }
  throw new Error(`Provider card not found for ${label}`);
}

export function stubToolsFetch(options: ToolsFetchOptions = {}) {
  const {
    providers = DEFAULT_PROVIDERS_PAYLOAD,
    connections = { connections: [] },
    activity = { events: [] },
    usage = { usage: null, approachingLimit: false },
    delayProvidersMs = 0,
    oauthConnect,
    apiKeyConnect,
    disconnect,
    onFetch,
  } = options;

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      onFetch?.(url, init);

      if (url.includes("/api/tools/providers")) {
        if (delayProvidersMs > 0) {
          await new Promise((r) => setTimeout(r, delayProvidersMs));
        }
        return {
          ok: true,
          json: async () => await resolve(providers),
        } as Response;
      }
      if (url.includes("/api/tools/connections")) {
        return {
          ok: true,
          json: async () => await resolve(connections),
        } as Response;
      }
      if (url.includes("/api/tools/activity")) {
        return {
          ok: true,
          json: async () => await resolve(activity),
        } as Response;
      }
      if (url.includes("/api/tools/usage")) {
        return {
          ok: true,
          json: async () => await resolve(usage),
        } as Response;
      }
      if (url.includes("/api/tools/connect/oauth") && method === "POST") {
        const handler = oauthConnect ?? (async () => ({
          ok: true,
          json: async () => ({
            authorizeUrl: "https://auth.test.local/oauth/start",
            popupWidth: 640,
            popupHeight: 720,
          }),
        }));
        return (await handler(init?.body as string)) as Response;
      }
      if (url.includes("/api/tools/connect/api-key") && method === "POST") {
        const handler = apiKeyConnect ?? (async () => ({
          ok: true,
          json: async () => ({}),
        }));
        return (await handler(init?.body as string)) as Response;
      }
      if (url.includes("/api/tools/disconnect") && method === "POST") {
        const handler = disconnect ?? (async () => ({
          ok: true,
          json: async () => ({}),
        }));
        return (await handler(init?.body as string)) as Response;
      }
      throw new Error(`Unexpected fetch: ${method} ${url}`);
    }),
  );
}
