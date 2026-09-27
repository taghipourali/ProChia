import { lazy, Suspense, type ComponentType } from 'react';
import { createBrowserRouter, createHashRouter } from 'react-router';
import { Spinner } from '@prochia/ui';
import { Layout } from './components/Layout';
import { MenuPage } from './pages/MenuPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { TablePage } from './pages/TablePage';

/** The menu ships in the first bundle (QR scans land there); everything else loads on demand. */
function page(load: () => Promise<Record<string, ComponentType>>, name: string) {
  const Component = lazy(async () => ({ default: (await load())[name]! }));
  return (
    <Suspense
      fallback={
        <div style={{ display: 'grid', placeItems: 'center', padding: 48 }}>
          <Spinner />
        </div>
      }
    >
      <Component />
    </Suspense>
  );
}

// The static demo is served from plain files, so its routes live in the URL hash.
const createRouter = import.meta.env.VITE_DEMO ? createHashRouter : createBrowserRouter;

export const router = createRouter([
  {
    element: <Layout />,
    children: [
      { index: true, element: <MenuPage /> },
      { path: 'cart', element: page(() => import('./pages/CartPage'), 'CartPage') },
      { path: 'orders', element: page(() => import('./pages/OrdersPage'), 'OrdersPage') },
      { path: 'orders/:id', element: page(() => import('./pages/OrderPage'), 'OrderPage') },
      { path: 'plans', element: page(() => import('./pages/PlansPage'), 'PlansPage') },
      { path: 'wallet', element: page(() => import('./pages/WalletPage'), 'WalletPage') },
      { path: 'club', element: page(() => import('./pages/ClubPage'), 'ClubPage') },
      { path: 'account', element: page(() => import('./pages/AccountPage'), 'AccountPage') },
      { path: 'account/health', element: page(() => import('./pages/HealthPage'), 'HealthPage') },
      {
        path: 'account/insights',
        element: page(() => import('./pages/InsightsPage'), 'InsightsPage'),
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
  { path: 'login', element: page(() => import('./pages/LoginPage'), 'LoginPage') },
  { path: 'welcome', element: page(() => import('./pages/OnboardingPage'), 'OnboardingPage') },
  { path: 't/:code', element: <TablePage /> },
]);
