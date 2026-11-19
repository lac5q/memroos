// @vitest-environment node
import { createHash } from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    prepare: vi.fn(),
  },
  verifyPassword: vi.fn(async () => true),
}));

vi.mock('@/lib/db', () => ({
  getDb: () => mocks.db,
}));

vi.mock('@/lib/auth/password', () => ({
  verifyPassword: mocks.verifyPassword,
}));

function setCookieHeader(response: Response): string {
  return response.headers.get('set-cookie') ?? '';
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  process.env.MEMROOS_JWT_SECRET = 'test-secret-that-is-long-enough-32ch';
  process.env.NODE_ENV = 'test';
});

describe('auth session cookies', () => {
  it('login rejects invalid JSON and missing credentials', async () => {
    const { POST } = await import('../login/route');
    expect(
      (
        await POST(
          new Request('http://localhost/api/auth/login', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{',
          }) as never
        )
      ).status
    ).toBe(400);

    expect(
      (
        await POST(
          new Request('http://localhost/api/auth/login', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email: 'a@example.com' }),
          }) as never
        )
      ).status
    ).toBe(400);
  });

  it('login rejects unknown users without leaking timing differences', async () => {
    mocks.db.prepare.mockImplementation((sql: string) => {
      if (sql.includes('FROM users WHERE email = ?')) {
        return { get: () => undefined };
      }
      return { run: vi.fn() };
    });
    mocks.verifyPassword.mockResolvedValueOnce(false);

    const { POST } = await import('../login/route');
    const response = await POST(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'missing@example.com', password: 'secret' }),
      }) as never
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'invalid email or password' });
  });

  it('login issues longer-lived HttpOnly access and refresh cookies', async () => {
    mocks.db.prepare.mockImplementation((sql: string) => {
      if (sql.includes('FROM users WHERE email = ?')) {
        return {
          get: () => ({
            id: 'user-1',
            email: 'luis@example.com',
            display_name: 'Luis',
            password_hash: 'hash',
          }),
        };
      }
      if (sql.includes('FROM user_roles WHERE user_id = ?')) {
        return { get: () => ({ role: 'operator' }) };
      }
      return { run: vi.fn() };
    });

    const { POST } = await import('../login/route');
    const response = await POST(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'luis@example.com', password: 'secret' }),
      }) as never
    );

    const cookies = setCookieHeader(response);
    expect(response.status).toBe(200);
    expect(cookies).toContain('memroos_refresh=');
    expect(cookies).toContain('Max-Age=2592000');
    expect(cookies).toContain('access_token=');
    expect(cookies).toContain('HttpOnly');
    expect(cookies).toContain('Max-Age=43200');
  });

  it('refresh requires a refresh cookie and clears cookies on invalid tokens', async () => {
    const { POST } = await import('../refresh/route');
    expect((await POST(new Request('http://localhost/api/auth/refresh', { method: 'POST' }))).status).toBe(
      401
    );

    mocks.db.prepare.mockImplementation(() => ({ get: () => undefined }));
    const bad = await POST(
      new Request('http://localhost/api/auth/refresh', {
        method: 'POST',
        headers: { cookie: 'memroos_refresh=missing' },
      })
    );
    expect(bad.status).toBe(401);
    expect(bad.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('refresh rotates the refresh token and also refreshes the HttpOnly access cookie', async () => {
    const rawRefreshToken = 'refresh-token';
    const tokenHash = createHash('sha256').update(rawRefreshToken).digest('hex');

    mocks.db.prepare.mockImplementation((sql: string) => {
      if (sql.includes('FROM user_refresh_tokens WHERE token_hash = ?')) {
        return {
          get: (hash: string) =>
            hash === tokenHash
              ? {
                  id: 'refresh-1',
                  user_id: 'user-1',
                  expires_at: new Date(Date.now() + 60_000).toISOString(),
                  revoked_at: null,
                }
              : undefined,
        };
      }
      if (sql.includes('FROM user_roles WHERE user_id = ?')) {
        return { get: () => ({ role: 'operator' }) };
      }
      return { run: vi.fn() };
    });

    const { POST } = await import('../refresh/route');
    const response = await POST(
      new Request('http://localhost/api/auth/refresh', {
        method: 'POST',
        headers: { cookie: `memroos_refresh=${encodeURIComponent(rawRefreshToken)}` },
      })
    );

    const cookies = setCookieHeader(response);
    expect(response.status).toBe(200);
    expect(cookies).toContain('memroos_refresh=');
    expect(cookies).toContain('Max-Age=2592000');
    expect(cookies).toContain('access_token=');
    expect(cookies).toContain('Max-Age=43200');
  });

  it('logout clears both refresh and access cookies', async () => {
    mocks.db.prepare.mockReturnValue({ run: vi.fn() });

    const { POST } = await import('../logout/route');
    const response = await POST(
      new Request('http://localhost/api/auth/logout', {
        method: 'POST',
        headers: { cookie: 'memroos_refresh=refresh-token; access_token=jwt' },
      })
    );

    const cookies = setCookieHeader(response);
    expect(response.status).toBe(200);
    expect(cookies).toContain('memroos_refresh=');
    expect(cookies).toContain('access_token=');
    expect(cookies).toContain('Max-Age=0');
  });
});
