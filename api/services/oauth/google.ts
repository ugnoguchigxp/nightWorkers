import { AuthError } from '../../lib/errors';
import type { OAuthProvider, OAuthUser } from './base';

export class GoogleOAuthClient implements OAuthProvider {
  constructor(
    private clientId: string,
    private clientSecret: string,
    private redirectUri: string
  ) {}

  getAuthorizationUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  async exchangeCode(code: string): Promise<{ accessToken: string; user: OAuthUser }> {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: this.redirectUri,
      }),
    });

    if (!tokenRes.ok) throw new AuthError('Failed to exchange Google token');
    const tokenData = await tokenRes.json();

    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    if (!userRes.ok) throw new AuthError('Failed to get Google user profile');
    const userData = await userRes.json();

    return {
      accessToken: tokenData.access_token,
      user: {
        id: userData.id,
        email: userData.email,
        name: userData.name || userData.given_name || 'Google User',
      },
    };
  }
}
