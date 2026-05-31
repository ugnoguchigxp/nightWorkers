export interface OAuthUser {
  id: string; // external id
  email: string;
  name: string;
}

export interface OAuthProvider {
  getAuthorizationUrl(state: string): string;
  exchangeCode(code: string): Promise<{ accessToken: string; user: OAuthUser }>;
}
