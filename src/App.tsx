import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRouter, RouterProvider } from '@tanstack/react-router';
import { AuthProvider, useAuth } from './lib/auth';
import { NightWorkersI18nProvider } from './modules/nightworkers/i18n/NightWorkersI18nProvider';
// Let tanstack router generate it dynamically if not exist
import { routeTree } from './routeTree.gen';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  },
});

// Set up a Router instance
const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  context: {
    queryClient,
    auth: undefined as unknown as ReturnType<typeof useAuth>, // set by provider
  },
});

// Register things for typesafety
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

function InnerApp() {
  const auth = useAuth();
  return <RouterProvider router={router} context={{ auth }} />;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <NightWorkersI18nProvider>
          <InnerApp />
        </NightWorkersI18nProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
