import { createBrowserRouter } from 'react-router';
import { Layout } from './components/Layout';
import { AccountPage } from './pages/AccountPage';
import { CartPage } from './pages/CartPage';
import { ClubPage } from './pages/ClubPage';
import { HealthPage } from './pages/HealthPage';
import { InsightsPage } from './pages/InsightsPage';
import { LoginPage } from './pages/LoginPage';
import { MenuPage } from './pages/MenuPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { OrderPage } from './pages/OrderPage';
import { OrdersPage } from './pages/OrdersPage';
import { PlansPage } from './pages/PlansPage';
import { TablePage } from './pages/TablePage';
import { WalletPage } from './pages/WalletPage';

export const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { index: true, element: <MenuPage /> },
      { path: 'cart', element: <CartPage /> },
      { path: 'orders', element: <OrdersPage /> },
      { path: 'orders/:id', element: <OrderPage /> },
      { path: 'plans', element: <PlansPage /> },
      { path: 'wallet', element: <WalletPage /> },
      { path: 'club', element: <ClubPage /> },
      { path: 'account', element: <AccountPage /> },
      { path: 'account/health', element: <HealthPage /> },
      { path: 'account/insights', element: <InsightsPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
  { path: 'login', element: <LoginPage /> },
  { path: 'welcome', element: <OnboardingPage /> },
  { path: 't/:code', element: <TablePage /> },
]);
