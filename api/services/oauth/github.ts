import { AuthError } from '../../lib/errors';
import type { OAuthProvider, OAuthUser } from './base';

type GitHubEmail = {
  email: string;
  primary: boolean;
};

export class GitHubOAuthClient implements OAuthProvider {
  constructor(
    private clientId: string,
    private clientSecret: string,
    private redirectUri: string
  ) {}

  getAuthorizationUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      scope: 'read:user user:email',
      state,
    });
    return `https://github.com/login/oauth/authorize?${params.toString()}`;
  }

  async exchangeCode(code: string): Promise<{ accessToken: string; user: OAuthUser }> {
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code,
        redirect_uri: this.redirectUri,
      }),
    });

    if (!tokenRes.ok) throw new AuthError('Failed to exchange GitHub token');
    const tokenData = await tokenRes.json();
    if (tokenData.error) throw new AuthError(tokenData.error_description || tokenData.error);

    // Get user
    const userRes = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });

    if (!userRes.ok) throw new AuthError('Failed to get GitHub user profile');
    const userData = await userRes.json();

    // Get emails
    const emailRes = await fetch('https://api.github.com/user/emails', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });

    let primaryEmail = userData.email;
    if (emailRes.ok) {
      const emails = (await emailRes.json()) as GitHubEmail[];
      const primary = emails.find((e) => e.primary) || emails[0];
      if (primary) primaryEmail = primary.email;
    }

    if (!primaryEmail) throw new AuthError('Email access required from GitHub');

    return {
      accessToken: tokenData.access_token,
      user: {
        id: userData.id.toString(),
        email: primaryEmail,
        name: userData.name || userData.login,
      },
    };
  }
}
