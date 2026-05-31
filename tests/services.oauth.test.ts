import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthError } from '../api/lib/errors';
import { GitHubOAuthClient } from '../api/services/oauth/github';
import { GoogleOAuthClient } from '../api/services/oauth/google';

describe('OAuth clients', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('builds Google authorization URL with required params', () => {
    const client = new GoogleOAuthClient('gid', 'gsecret', 'http://localhost/callback');
    const url = new URL(client.getAuthorizationUrl('state-123'));

    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe('gid');
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost/callback');
    expect(url.searchParams.get('state')).toBe('state-123');
  });

  it('exchanges Google code and returns normalized user', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'google-access' }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'g-user-id',
            email: 'google@example.com',
            given_name: 'Google Given',
          }),
          { status: 200 }
        )
      );

    const client = new GoogleOAuthClient('gid', 'gsecret', 'http://localhost/callback');
    const result = await client.exchangeCode('code-1');

    expect(result).toEqual({
      accessToken: 'google-access',
      user: {
        id: 'g-user-id',
        email: 'google@example.com',
        name: 'Google Given',
      },
    });
  });

  it('throws AuthError when Google token exchange fails', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 400 }));

    const client = new GoogleOAuthClient('gid', 'gsecret', 'http://localhost/callback');
    await expect(client.exchangeCode('bad')).rejects.toThrow(AuthError);
  });

  it('builds GitHub authorization URL with required params', () => {
    const client = new GitHubOAuthClient('ghid', 'ghsecret', 'http://localhost/callback');
    const url = new URL(client.getAuthorizationUrl('state-456'));

    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('ghid');
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost/callback');
    expect(url.searchParams.get('state')).toBe('state-456');
  });

  it('exchanges GitHub code and selects primary email', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'github-access' }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 42,
            login: 'octocat',
            name: 'Octo Cat',
            email: null,
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { email: 'secondary@example.com', primary: false },
            { email: 'primary@example.com', primary: true },
          ]),
          { status: 200 }
        )
      );

    const client = new GitHubOAuthClient('ghid', 'ghsecret', 'http://localhost/callback');
    const result = await client.exchangeCode('good-code');

    expect(result).toEqual({
      accessToken: 'github-access',
      user: {
        id: '42',
        email: 'primary@example.com',
        name: 'Octo Cat',
      },
    });
  });

  it('throws when GitHub token payload includes error', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: 'bad_verification_code',
          error_description: 'The code passed is incorrect or expired.',
        }),
        { status: 200 }
      )
    );

    const client = new GitHubOAuthClient('ghid', 'ghsecret', 'http://localhost/callback');
    await expect(client.exchangeCode('bad-code')).rejects.toThrow(AuthError);
  });

  it('throws when GitHub user email cannot be resolved', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'github-access' }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 42,
            login: 'octocat',
            name: 'Octo Cat',
            email: null,
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));

    const client = new GitHubOAuthClient('ghid', 'ghsecret', 'http://localhost/callback');
    await expect(client.exchangeCode('good-code')).rejects.toThrow(
      'Email access required from GitHub'
    );
  });
});
