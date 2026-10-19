import { Navigate, Route, Routes } from 'react-router-dom';
import RequireAuth from './lib/auth/RequireAuth';
import AppLayout from './components/AppLayout';
import LoginPage from './pages/LoginPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import DashboardPage from './pages/DashboardPage';
import SettingsPage from './pages/SettingsPage';
import NewCommissionPage, { EditOrderPage } from './pages/NewCommissionPage';
import OrdersPage from './pages/OrdersPage';
import OrderDetailPage from './pages/OrderDetailPage';
import PlannedPage from './pages/PlannedPage';

export default function App() {
  return (
    <Routes>
      <Route path="/anmelden" element={<LoginPage />} />
      <Route path="/passwort-vergessen" element={<ForgotPasswordPage />} />
      <Route path="/passwort-neu" element={<ResetPasswordPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="neue-provision" element={<NewCommissionPage />} />
          <Route path="kunden" element={<OrdersPage />} />
          <Route path="kunden/:id" element={<OrderDetailPage />} />
          <Route path="kunden/:id/bearbeiten" element={<EditOrderPage />} />
          <Route path="historisch" element={<PlannedPage title="Historische Auszahlungen" description="Erfassen, Bearbeiten und Löschen historischer Auszahlungen folgt im nächsten Schritt. Das Datenbankschema ist bereits angelegt." />} />
          <Route path="auswertungen" element={<PlannedPage title="Auswertungen" description="Diagramme und Auswertungen sowie die Exporte (CSV/JSON) folgen in einem späteren Schritt." />} />
          <Route path="einstellungen" element={<SettingsPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
