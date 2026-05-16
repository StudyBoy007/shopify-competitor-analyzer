import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AppProvider } from './store/AppContext.jsx';
import Layout from './components/Layout.jsx';
import AuthGate from './components/AuthGate.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import SitesPage from './pages/SitesPage.jsx';
import ProductsPage from './pages/ProductsPage.jsx';
import RelationsPage from './pages/RelationsPage.jsx';
import ProductSpecsPage from './pages/ProductSpecsPage.jsx';
import ReportsPage from './pages/ReportsPage.jsx';
import AdminUsersPage from './pages/AdminUsersPage.jsx';
import AdminSettingsPage from './pages/AdminSettingsPage.jsx';

export default function App() {
  return (
    <AppProvider>
      <AuthGate>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Layout />}>
              <Route index element={<DashboardPage />} />
              <Route path="sites" element={<SitesPage />} />
              <Route path="products" element={<ProductsPage />} />
              <Route path="relations" element={<RelationsPage />} />
              <Route path="products/:id/specs" element={<ProductSpecsPage />} />
              <Route path="reports" element={<ReportsPage />} />
              <Route path="admin/users" element={<AdminUsersPage />} />
              <Route path="admin/settings" element={<AdminSettingsPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthGate>
    </AppProvider>
  );
}
