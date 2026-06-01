import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Link, Outlet } from '@tanstack/react-router';
import { CheckSquare } from 'lucide-react';
import type { useAuth } from '../lib/auth';

interface RouterContext {
  queryClient: QueryClient;
  auth: ReturnType<typeof useAuth>;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: () => {
    const isHome =
      typeof globalThis !== 'undefined' && 'location' in globalThis
        ? globalThis.location.pathname === '/'
        : false;

    return (
      <div className="min-h-screen bg-[#141416]">
        {!isHome ? (
          <nav className="sticky top-0 z-50 flex items-center gap-6 border-b border-zinc-800 bg-[#0f0f11] px-6 py-3 backdrop-blur-md">
            <Link to="/" className="flex items-center gap-2 transition-opacity hover:opacity-80">
              <CheckSquare className="h-5 w-5 text-zinc-400" />
              <span className="text-xl font-bold tracking-tight text-zinc-100">NightWorkers</span>
            </Link>
            <div className="flex-1" />
          </nav>
        ) : null}
        <main>
          <Outlet />
        </main>
      </div>
    );
  },
});
