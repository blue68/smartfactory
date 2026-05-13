import { useEffect, useState, type ComponentType } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';

const isDev = import.meta.env.DEV;
const enableQueryDevtools =
  isDev &&
  (
    typeof window !== 'undefined' &&
    (
      window.localStorage.getItem('sf-enable-rq-devtools') === '1' ||
      new URLSearchParams(window.location.search).get('rqdevtools') === '1'
    )
  );

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 20,
      gcTime: 1000 * 60,
      retry: (failureCount, error) => {
        if (error instanceof Error && error.name === 'ApiError') return false;
        return failureCount < 2;
      },
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: false,
      gcTime: 1000 * 60,
    },
  },
});

function DevOnlyQueryDevtools() {
  const [DevtoolsComponent, setDevtoolsComponent] = useState<ComponentType<{ initialIsOpen?: boolean; position?: 'top' | 'bottom' }> | null>(null);

  useEffect(() => {
    if (!enableQueryDevtools) return;

    let active = true;

    void import('@tanstack/react-query-devtools').then((mod) => {
      if (!active) return;
      setDevtoolsComponent(() => mod.ReactQueryDevtools);
    });

    return () => {
      active = false;
    };
  }, []);

  if (!enableQueryDevtools || !DevtoolsComponent) {
    return null;
  }

  return <DevtoolsComponent initialIsOpen={false} position="bottom" />;
}

export default function RootProviders() {
  return (
    <QueryClientProvider client={queryClient}>
      <App />
      <DevOnlyQueryDevtools />
    </QueryClientProvider>
  );
}
