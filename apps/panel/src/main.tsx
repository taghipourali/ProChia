import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router';
import { startDemo } from '@prochia/demo/client';
import { ToastProvider } from '@prochia/ui';
import '@prochia/ui/styles.css';
import './panel.css';
import { ApiError } from './lib/api';
import { AuthProvider } from './lib/auth';
import { router } from './router';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, err) =>
        !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
      staleTime: 15_000,
    },
  },
});

// The static demo first starts the in-browser API (see apps/demo).
const ready = import.meta.env.VITE_DEMO ? startDemo() : Promise.resolve();

void ready.then(() =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <AuthProvider>
            <RouterProvider router={router} />
          </AuthProvider>
        </ToastProvider>
      </QueryClientProvider>
    </StrictMode>,
  ),
);
