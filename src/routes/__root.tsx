import { Avatar, Button, DropdownMenu } from '@repo/design-system';
import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Link, Outlet } from '@tanstack/react-router';
import { CheckSquare, FolderGit2, LogOut, User } from 'lucide-react';
import type { useAuth } from '../lib/auth';

interface RouterContext {
  queryClient: QueryClient;
  auth: ReturnType<typeof useAuth>;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: () => {
    const { auth } = Route.useRouteContext();

    return (
      <div className="min-h-screen bg-background">
        <nav className="flex items-center gap-6 border-b border-border px-6 py-3 bg-card/50 backdrop-blur-md sticky top-0 z-50">
          <Link to="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <div className="bg-primary p-1.5 rounded-lg">
              <CheckSquare className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="font-bold text-xl tracking-tight">NightWorkers</span>
          </Link>

          <div className="flex items-center gap-2">
            <Button variant="ghost" asChild size="sm">
              <Link to="/" className="flex items-center gap-2">
                <CheckSquare className="h-4 w-4" />
                Tasks
              </Link>
            </Button>
            <Button variant="ghost" asChild size="sm">
              <Link to="/repositories" className="flex items-center gap-2">
                <FolderGit2 className="h-4 w-4" />
                Repositories
              </Link>
            </Button>
          </div>

          <div className="flex-1" />

          <div className="flex items-center gap-4">
            {auth.user ? (
              <DropdownMenu
                align="end"
                trigger={
                  <div className="cursor-pointer">
                    <Avatar
                      src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${auth.user.email}`}
                      fallback={auth.user.email[0].toUpperCase()}
                      size="md"
                      className="border border-border hover:border-primary/50 transition-colors"
                    />
                  </div>
                }
                items={[
                  {
                    label: 'Profile',
                    icon: <User className="h-4 w-4" />,
                    onClick: () => console.log('Profile clicked'),
                  },
                  {
                    label: 'Logout',
                    icon: <LogOut className="h-4 w-4" />,
                    onClick: () => auth.logout(),
                  },
                ]}
              />
            ) : (
              <Button asChild size="sm">
                <Link to="/login">Login</Link>
              </Button>
            )}
          </div>
        </nav>
        <main>
          <Outlet />
        </main>
      </div>
    );
  },
});
