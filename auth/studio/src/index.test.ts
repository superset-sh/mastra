import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MastraAuthStudio } from './index';
import type { StudioUser } from './index';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a mock request object that supports both the standard `Request` API
 * (used by getCurrentUser, getLogoutUrl, getSessionIdFromRequest) and the
 * Hono-style `.header(name)` API (used by authenticateToken).
 */
function mockRequest(opts: { cookie?: string; authorization?: string } = {}): any {
  const headers = new Headers();
  if (opts.cookie) headers.set('Cookie', opts.cookie);
  if (opts.authorization) headers.set('Authorization', opts.authorization);

  const req = new Request('http://localhost/test', { headers });
  // Hono's HonoRequest exposes .header(name) — the actual request object
  // passed to authenticateToken is a Hono request, not a plain Request.
  (req as any).header = (name: string) => headers.get(name);
  return req;
}

const SHARED_API = 'https://api.mastra.ai/v1';

const mockMeResponse = {
  user: {
    id: 'user-1',
    email: 'alice@example.com',
    firstName: 'Alice',
    lastName: 'Smith',
    profilePictureUrl: 'https://example.com/avatar.png',
  },
  organizationId: 'org-1',
  role: 'admin',
  permissions: ['projects:read', 'projects:write'],
};

const mockVerifyResponse = {
  user: {
    id: 'user-2',
    email: 'bob@example.com',
    firstName: 'Bob',
    lastName: '',
  },
  organizationId: 'org-2',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MastraAuthStudio', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let auth: MastraAuthStudio;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
    auth = new MastraAuthStudio({ sharedApiUrl: SHARED_API });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  describe('constructor', () => {
    it('should use the provided sharedApiUrl', () => {
      const a = new MastraAuthStudio({ sharedApiUrl: 'https://custom.api/v1' });
      // Verify by calling getLoginUrl and checking the URL prefix
      const url = a.getLoginUrl('https://app.mastra.ai/callback', '');
      expect(url).toContain('https://custom.api/v1/auth/login');
    });

    it('should strip trailing slash from sharedApiUrl', () => {
      const a = new MastraAuthStudio({ sharedApiUrl: 'https://api.mastra.ai/v1/' });
      const url = a.getLoginUrl('https://app.mastra.ai/callback', '');
      expect(url).toContain('https://api.mastra.ai/v1/auth/login');
      expect(url).not.toContain('v1//auth');
    });

    it('should fall back to MASTRA_SHARED_API_URL env var', () => {
      process.env.MASTRA_SHARED_API_URL = 'https://env-api.mastra.ai/v1';
      const a = new MastraAuthStudio();
      const url = a.getLoginUrl('https://app.mastra.ai/callback', '');
      expect(url).toContain('https://env-api.mastra.ai/v1/auth/login');
      delete process.env.MASTRA_SHARED_API_URL;
    });

    it('should fall back to localhost default when no config or env var', () => {
      delete process.env.MASTRA_SHARED_API_URL;
      const a = new MastraAuthStudio();
      const url = a.getLoginUrl('https://app.mastra.ai/callback', '');
      expect(url).toContain('http://localhost:3010/v1/auth/login');
    });

    it('should set isMastraCloudAuth to true', () => {
      expect(auth.isMastraCloudAuth).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // authenticateToken
  // -------------------------------------------------------------------------

  describe('authenticateToken', () => {
    it('should authenticate via session cookie when present', async () => {
      fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify(mockMeResponse), { status: 200 }));

      const req = mockRequest({ cookie: 'wos-session=sealed-token-abc' });
      const user = await auth.authenticateToken('', req);

      expect(user).toEqual({
        id: 'user-1',
        email: 'alice@example.com',
        name: 'Alice Smith',
        avatarUrl: 'https://example.com/avatar.png',
        organizationId: 'org-1',
        role: 'admin',
        permissions: ['projects:read', 'projects:write'],
      });

      // Should have called /auth/me with the cookie
      expect(fetchSpy).toHaveBeenCalledWith(
        `${SHARED_API}/auth/me`,
        expect.objectContaining({
          headers: expect.objectContaining({
            Cookie: 'wos-session=sealed-token-abc',
          }),
        }),
      );
    });

    it('should fall back to bearer token when session cookie is absent', async () => {
      fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify(mockVerifyResponse), { status: 200 }));

      const req = mockRequest();
      const user = await auth.authenticateToken('cli-token-xyz', req);

      expect(user).toEqual({
        id: 'user-2',
        email: 'bob@example.com',
        name: 'Bob',
        organizationId: 'org-2',
      });

      // Should have called /auth/verify with the bearer token
      expect(fetchSpy).toHaveBeenCalledWith(
        `${SHARED_API}/auth/verify`,
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer cli-token-xyz',
          }),
        }),
      );
    });

    it('should fall back to bearer token when session cookie validation fails', async () => {
      // First call: /auth/me returns 401 (invalid session)
      fetchSpy.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));
      // Second call: /auth/verify returns user
      fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify(mockVerifyResponse), { status: 200 }));

      const req = mockRequest({ cookie: 'wos-session=expired-token' });
      const user = await auth.authenticateToken('valid-bearer', req);

      expect(user).toEqual({
        id: 'user-2',
        email: 'bob@example.com',
        name: 'Bob',
        organizationId: 'org-2',
      });

      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('should return null when both session cookie and bearer token fail', async () => {
      // /auth/me fails
      fetchSpy.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));
      // /auth/verify fails
      fetchSpy.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));

      const req = mockRequest({ cookie: 'wos-session=bad' });
      const user = await auth.authenticateToken('bad-token', req);

      expect(user).toBeNull();
    });

    it('should return null when no cookie and no token', async () => {
      const req = mockRequest();
      const user = await auth.authenticateToken('', req);

      expect(user).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('should return null when fetch throws a network error', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('Network error'));

      const req = mockRequest({ cookie: 'wos-session=some-token' });
      const user = await auth.authenticateToken('', req);

      expect(user).toBeNull();
    });

    it('should handle user with only firstName (no lastName)', async () => {
      const response = {
        ...mockMeResponse,
        user: { ...mockMeResponse.user, lastName: '' },
      };
      fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify(response), { status: 200 }));

      const req = mockRequest({ cookie: 'wos-session=token' });
      const user = await auth.authenticateToken('', req);

      expect(user?.name).toBe('Alice');
    });

    it('should handle user with no name fields', async () => {
      const response = {
        ...mockMeResponse,
        user: { ...mockMeResponse.user, firstName: '', lastName: '' },
      };
      fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify(response), { status: 200 }));

      const req = mockRequest({ cookie: 'wos-session=token' });
      const user = await auth.authenticateToken('', req);

      expect(user?.name).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // authorizeUser
  // -------------------------------------------------------------------------

  describe('authorizeUser', () => {
    it('should return true for user with valid id', () => {
      expect(auth.authorizeUser({ id: 'user-1' })).toBe(true);
    });

    it('should return false for user with empty id', () => {
      expect(auth.authorizeUser({ id: '' })).toBe(false);
    });

    it('should return false for null/undefined user', () => {
      expect(auth.authorizeUser(null as any)).toBe(false);
      expect(auth.authorizeUser(undefined as any)).toBe(false);
    });

    it('can be overridden with custom authorization logic', async () => {
      const customAuth = new MastraAuthStudio({
        sharedApiUrl: SHARED_API,
        async authorizeUser(user: StudioUser): Promise<boolean> {
          return user?.role === 'admin';
        },
      });

      expect(await customAuth.authorizeUser({ id: 'u1', role: 'admin' })).toBe(true);
      expect(await customAuth.authorizeUser({ id: 'u2', role: 'viewer' })).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // ISSOProvider — getLoginUrl
  // -------------------------------------------------------------------------

  describe('getLoginUrl', () => {
    it('should build URL with product=deploy and redirect_uri', () => {
      const url = auth.getLoginUrl('https://deploy.mastra.ai/auth/callback', '');
      const parsed = new URL(url);

      expect(parsed.origin + parsed.pathname).toBe(`${SHARED_API}/auth/login`);
      expect(parsed.searchParams.get('product')).toBe('deploy');
      expect(parsed.searchParams.get('redirect_uri')).toBe('https://deploy.mastra.ai/auth/callback');
      expect(parsed.searchParams.get('post_login_redirect')).toBe('/');
    });

    it('should extract post_login_redirect from state (uuid|encodedPath)', () => {
      const state = 'abc-123|%2Fdashboard%2Fsettings';
      const url = auth.getLoginUrl('https://deploy.mastra.ai/auth/callback', state);
      const parsed = new URL(url);

      expect(parsed.searchParams.get('post_login_redirect')).toBe('/dashboard/settings');
    });

    it('should default post_login_redirect to / when state has no pipe', () => {
      const url = auth.getLoginUrl('https://deploy.mastra.ai/auth/callback', 'just-a-uuid');
      const parsed = new URL(url);

      expect(parsed.searchParams.get('post_login_redirect')).toBe('/');
    });

    it('should default post_login_redirect to / when decode fails', () => {
      // %E0%A4%A is an invalid percent-encoding sequence
      const state = 'abc|%E0%A4%A';
      const url = auth.getLoginUrl('https://deploy.mastra.ai/auth/callback', state);
      const parsed = new URL(url);

      expect(parsed.searchParams.get('post_login_redirect')).toBe('/');
    });

    it('should handle empty state', () => {
      const url = auth.getLoginUrl('https://deploy.mastra.ai/auth/callback', '');
      const parsed = new URL(url);

      expect(parsed.searchParams.get('post_login_redirect')).toBe('/');
    });
  });

  // -------------------------------------------------------------------------
  // ISSOProvider — handleCallback
  // -------------------------------------------------------------------------

  describe('handleCallback', () => {
    it('should forward code and state to shared API callback', async () => {
      // Mock redirect response with Set-Cookie header
      const headers = new Headers();
      headers.append('Set-Cookie', 'wos-session=new-sealed-token; HttpOnly; Path=/');
      headers.set('Location', 'https://dashboard.mastra.ai');

      fetchSpy
        // First call: /auth/callback (redirect response)
        .mockResolvedValueOnce(new Response(null, { status: 302, headers }))
        // Second call: /auth/me (verify the new session)
        .mockResolvedValueOnce(new Response(JSON.stringify(mockMeResponse), { status: 200 }));

      const result = await auth.handleCallback('auth-code-123', 'state-abc');

      expect(result.user).toEqual({
        id: 'user-1',
        email: 'alice@example.com',
        name: 'Alice Smith',
        avatarUrl: 'https://example.com/avatar.png',
        organizationId: 'org-1',
        role: 'admin',
        permissions: ['projects:read', 'projects:write'],
      });
      expect(result.tokens.accessToken).toBe('new-sealed-token');
      expect(result.cookies).toContain('wos-session=new-sealed-token; HttpOnly; Path=/');

      // Verify the callback URL was constructed correctly
      const callUrl = fetchSpy.mock.calls[0]![0] as string;
      expect(callUrl).toContain(`${SHARED_API}/auth/callback`);
      expect(callUrl).toContain('code=auth-code-123');
      expect(callUrl).toContain('state=state-abc');
    });

    it('should throw when no session cookie in callback response', async () => {
      fetchSpy.mockResolvedValueOnce(new Response(null, { status: 302 }));

      await expect(auth.handleCallback('code', 'state')).rejects.toThrow('No session cookie returned from callback');
    });

    it('should throw when session validation fails after callback', async () => {
      const headers = new Headers();
      headers.append('Set-Cookie', 'wos-session=invalid-sealed; HttpOnly; Path=/');

      fetchSpy
        .mockResolvedValueOnce(new Response(null, { status: 302, headers }))
        .mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));

      await expect(auth.handleCallback('code', 'state')).rejects.toThrow('Session validation failed after callback');
    });
  });

  // -------------------------------------------------------------------------
  // ISSOProvider — other methods
  // -------------------------------------------------------------------------

  describe('setCallbackCookieHeader', () => {
    it('should be a no-op', () => {
      expect(() => auth.setCallbackCookieHeader('some-cookie')).not.toThrow();
    });
  });

  describe('getLoginCookies', () => {
    it('should return undefined', () => {
      expect(auth.getLoginCookies()).toBeUndefined();
    });
  });

  describe('getLoginButtonConfig', () => {
    it('should return mastra-studio provider config', () => {
      const config = auth.getLoginButtonConfig();
      expect(config).toEqual({
        provider: 'mastra-studio',
        text: 'Sign in with Mastra',
      });
    });
  });

  // -------------------------------------------------------------------------
  // ISSOProvider — getLogoutUrl
  // -------------------------------------------------------------------------

  describe('getLogoutUrl', () => {
    it('should POST to shared API logout and return logoutUrl', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, logoutUrl: 'https://auth.workos.com/logout?...' }), { status: 200 }),
      );

      const req = mockRequest({ cookie: 'wos-session=session-token' });
      const url = await auth.getLogoutUrl('https://deploy.mastra.ai', req);

      expect(url).toBe('https://auth.workos.com/logout?...');
      expect(fetchSpy).toHaveBeenCalledWith(
        `${SHARED_API}/auth/logout`,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Cookie: 'wos-session=session-token',
          }),
        }),
      );
    });

    it('should return null when no session cookie in request', async () => {
      const req = mockRequest();
      const url = await auth.getLogoutUrl('https://deploy.mastra.ai', req);

      expect(url).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('should return null when shared API returns no logoutUrl', async () => {
      fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

      const req = mockRequest({ cookie: 'wos-session=session-token' });
      const url = await auth.getLogoutUrl('https://deploy.mastra.ai', req);

      expect(url).toBeNull();
    });

    it('should return null when fetch fails', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('Network error'));

      const req = mockRequest({ cookie: 'wos-session=session-token' });
      const url = await auth.getLogoutUrl('https://deploy.mastra.ai', req);

      expect(url).toBeNull();
    });

    it('should return null when shared API returns error status', async () => {
      fetchSpy.mockResolvedValueOnce(new Response('Server error', { status: 500 }));

      const req = mockRequest({ cookie: 'wos-session=session-token' });
      const url = await auth.getLogoutUrl('https://deploy.mastra.ai', req);

      expect(url).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // ISessionProvider
  // -------------------------------------------------------------------------

  describe('createSession', () => {
    it('should create a session with 24-hour expiry', async () => {
      const before = Date.now();
      const session = await auth.createSession('user-1');
      const after = Date.now();

      expect(session.userId).toBe('user-1');
      expect(session.id).toBeDefined();
      expect(session.createdAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(session.createdAt.getTime()).toBeLessThanOrEqual(after);
      expect(session.expiresAt.getTime() - session.createdAt.getTime()).toBe(24 * 60 * 60 * 1000);
    });

    it('should use accessToken from metadata as session id', async () => {
      const session = await auth.createSession('user-1', { accessToken: 'my-access-token' });

      expect(session.id).toBe('my-access-token');
      expect(session.metadata).toEqual({ accessToken: 'my-access-token' });
    });

    it('should generate random id when no accessToken in metadata', async () => {
      const s1 = await auth.createSession('user-1');
      const s2 = await auth.createSession('user-1');

      expect(s1.id).not.toBe(s2.id);
      // UUID v4 format
      expect(s1.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });
  });

  describe('validateSession', () => {
    it('should validate session via /auth/me and return Session', async () => {
      fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify(mockMeResponse), { status: 200 }));

      const session = await auth.validateSession('sealed-token');

      expect(session).not.toBeNull();
      expect(session!.id).toBe('sealed-token');
      expect(session!.userId).toBe('user-1');
      expect(session!.expiresAt.getTime() - session!.createdAt.getTime()).toBe(24 * 60 * 60 * 1000);
    });

    it('should return null when session is invalid', async () => {
      fetchSpy.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));

      const session = await auth.validateSession('bad-token');

      expect(session).toBeNull();
    });
  });

  describe('destroySession', () => {
    it('should POST to shared API logout with session cookie', async () => {
      fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

      await auth.destroySession('sealed-token');

      expect(fetchSpy).toHaveBeenCalledWith(
        `${SHARED_API}/auth/logout`,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Cookie: 'wos-session=sealed-token',
          }),
        }),
      );
    });

    it('should not throw when fetch fails (best effort)', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('Network error'));

      await expect(auth.destroySession('token')).resolves.not.toThrow();
    });
  });

  describe('refreshSession', () => {
    it('should delegate to validateSession', async () => {
      fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify(mockMeResponse), { status: 200 }));

      const session = await auth.refreshSession('sealed-token');

      expect(session).not.toBeNull();
      expect(session!.userId).toBe('user-1');
    });
  });

  describe('getSessionIdFromRequest', () => {
    it('should extract wos-session cookie from request', () => {
      const req = mockRequest({ cookie: 'other=foo; wos-session=my-token; another=bar' });
      expect(auth.getSessionIdFromRequest(req)).toBe('my-token');
    });

    it('should return null when no wos-session cookie', () => {
      const req = mockRequest({ cookie: 'other=foo' });
      expect(auth.getSessionIdFromRequest(req)).toBeNull();
    });

    it('should return null when no Cookie header', () => {
      const req = mockRequest();
      expect(auth.getSessionIdFromRequest(req)).toBeNull();
    });
  });

  describe('getSessionHeaders', () => {
    it('should return Set-Cookie header in development', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      const headers = auth.getSessionHeaders({
        id: 'token-123',
        userId: 'user-1',
        expiresAt: new Date(),
        createdAt: new Date(),
      });

      expect(headers['Set-Cookie']).toBe('wos-session=token-123; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400');
      expect(headers['Set-Cookie']).not.toContain('Secure');
      expect(headers['Set-Cookie']).not.toContain('Domain');

      process.env.NODE_ENV = originalEnv;
    });

    it('should include Secure and Domain in production', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const headers = auth.getSessionHeaders({
        id: 'token-123',
        userId: 'user-1',
        expiresAt: new Date(),
        createdAt: new Date(),
      });

      expect(headers['Set-Cookie']).toContain('Secure');
      expect(headers['Set-Cookie']).toContain('Domain=.mastra.ai');

      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('getClearSessionHeaders', () => {
    it('should return Set-Cookie header with Max-Age=0', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      const headers = auth.getClearSessionHeaders();

      expect(headers['Set-Cookie']).toBe('wos-session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');

      process.env.NODE_ENV = originalEnv;
    });

    it('should include Secure and Domain in production', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const headers = auth.getClearSessionHeaders();

      expect(headers['Set-Cookie']).toContain('Secure');
      expect(headers['Set-Cookie']).toContain('Domain=.mastra.ai');
      expect(headers['Set-Cookie']).toContain('Max-Age=0');

      process.env.NODE_ENV = originalEnv;
    });
  });

  // -------------------------------------------------------------------------
  // IUserProvider
  // -------------------------------------------------------------------------

  describe('getCurrentUser', () => {
    it('should return user from session cookie', async () => {
      fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify(mockMeResponse), { status: 200 }));

      const req = mockRequest({ cookie: 'wos-session=token' });
      const user = await auth.getCurrentUser(req);

      expect(user?.id).toBe('user-1');
      expect(user?.email).toBe('alice@example.com');
    });

    it('should fall back to Bearer token', async () => {
      fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify(mockVerifyResponse), { status: 200 }));

      const req = mockRequest({ authorization: 'Bearer cli-token' });
      const user = await auth.getCurrentUser(req);

      expect(user?.id).toBe('user-2');
      expect(user?.email).toBe('bob@example.com');
    });

    it('should prefer session cookie over Bearer token', async () => {
      fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify(mockMeResponse), { status: 200 }));

      const req = mockRequest({ cookie: 'wos-session=token', authorization: 'Bearer cli-token' });
      const user = await auth.getCurrentUser(req);

      // Should be the cookie-based user, not the bearer-based one
      expect(user?.id).toBe('user-1');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('should return null when neither cookie nor bearer present', async () => {
      const req = mockRequest();
      const user = await auth.getCurrentUser(req);

      expect(user).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('getUser', () => {
    it('should return null (not supported)', async () => {
      const user = await auth.getUser('user-1');
      expect(user).toBeNull();
    });
  });
});
