import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { Layout } from './components/Layout';
import { LoadingScreen } from './components/ui';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { InventoryPage } from './pages/InventoryPage';
import { AddItemPage } from './pages/AddItemPage';
import { ItemDetailPage } from './pages/ItemDetailPage';
import { QueuePage } from './pages/QueuePage';
import { StoragePage } from './pages/StoragePage';
import { SettingsPage } from './pages/SettingsPage';
import { AdminPage } from './pages/AdminPage';

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading, configured } = useAuth();

  if (loading) return <LoadingScreen label="Starting…" />;
  if (!configured) return <Navigate to="/login" replace />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <Protected>
            <Layout />
          </Protected>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="inventory" element={<InventoryPage />} />
        <Route path="add" element={<AddItemPage />} />
        <Route path="items/:id" element={<ItemDetailPage />} />
        <Route path="queue" element={<QueuePage />} />
        <Route path="storage" element={<StoragePage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="admin" element={<AdminPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
