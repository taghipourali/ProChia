import { createHashRouter } from 'react-router';
import { Shell } from './components/Shell';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { BoardPage } from './pages/BoardPage';
import { ClubPage } from './pages/ClubPage';
import { InventoryPage } from './pages/InventoryPage';
import { MembersPage } from './pages/MembersPage';
import { MenuPage } from './pages/MenuPage';
import { PaymentsPage } from './pages/PaymentsPage';
import { PlansPage } from './pages/PlansPage';
import { QrPage } from './pages/QrPage';
import { SettingsPage } from './pages/SettingsPage';
import { SmsPage } from './pages/SmsPage';

// Hash routing: the same build is served from a web server and from the Windows app's local files.
export const router = createHashRouter([
  {
    element: <Shell />,
    children: [
      { index: true, element: <BoardPage /> },
      { path: 'payments', element: <PaymentsPage /> },
      { path: 'menu', element: <MenuPage /> },
      { path: 'inventory', element: <InventoryPage /> },
      { path: 'members', element: <MembersPage /> },
      { path: 'club', element: <ClubPage /> },
      { path: 'plans', element: <PlansPage /> },
      { path: 'sms', element: <SmsPage /> },
      { path: 'analytics', element: <AnalyticsPage /> },
      { path: 'qr', element: <QrPage /> },
      { path: 'settings', element: <SettingsPage /> },
    ],
  },
]);
