import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { client } from '../lib/api';
import { apiPath } from '../lib/api-base';
import { useAuth } from '../lib/auth';

export const Route = createFileRoute('/login')({
  component: Login,
});

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [authMethods, setAuthMethods] = useState<{
    apiAuthRequired: boolean;
    local: boolean;
    oauth: {
      enabled: boolean;
      providers: {
        google: boolean;
        github: boolean;
      };
    };
  }>({
    apiAuthRequired: false,
    local: true,
    oauth: {
      enabled: false,
      providers: {
        google: false,
        github: false,
      },
    },
  });
  const { login, user, apiAuthRequired, isLoading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (isLoading) return;
    if (!apiAuthRequired || user) {
      navigate({ to: '/' });
    }
  }, [apiAuthRequired, isLoading, user, navigate]);

  useEffect(() => {
    let active = true;

    const loadAuthMethods = async () => {
      try {
        const res = await fetch(apiPath('/api/auth/methods'), { credentials: 'include' });
        if (!res.ok || !active) return;
        const data = (await res.json()) as {
          apiAuthRequired: boolean;
          local: boolean;
          oauth: {
            enabled: boolean;
            providers: {
              google: boolean;
              github: boolean;
            };
          };
        };
        setAuthMethods(data);
      } catch {
        // Keep safe default: local only
      }
    };

    loadAuthMethods();
    return () => {
      active = false;
    };
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const res = await client.auth.login.$post({ json: { email, password } });
      if (!res.ok) {
        throw new Error('Login failed');
      }
      const data = (await res.json()) as {
        user: { id: string; email: string };
      };
      login(data.user);
      navigate({ to: '/' });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Login failed');
    }
  };

  if (isLoading || !apiAuthRequired) {
    return null;
  }

  return (
    <div className="mx-auto max-w-md">
      <h1>Login</h1>
      {error && <p className="text-red-500">{error}</p>}
      {authMethods.local ? (
        <form onSubmit={handleLogin} className="flex flex-col gap-4">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="rounded border border-border bg-background px-2 py-2"
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="rounded border border-border bg-background px-2 py-2"
          />
          <button type="submit" className="rounded border border-border px-3 py-2">
            Login
          </button>
        </form>
      ) : null}

      {authMethods.local && authMethods.oauth.enabled ? (
        <hr className="my-8 border-border" />
      ) : null}

      {authMethods.oauth.enabled ? (
        <div className="flex flex-col gap-4">
          {authMethods.oauth.providers.google ? (
            <a href={apiPath('/api/auth/oauth/google')}>
              <button type="button" className="w-full rounded border border-border px-3 py-2">
                Login with Google
              </button>
            </a>
          ) : null}
          {authMethods.oauth.providers.github ? (
            <a href={apiPath('/api/auth/oauth/github')}>
              <button type="button" className="w-full rounded border border-border px-3 py-2">
                Login with GitHub
              </button>
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
