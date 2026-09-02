import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './lib/auth';
import { ThemeProvider } from './lib/theme';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Layout } from './components/Layout';
import { LoginPage } from './features/auth/LoginPage';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { InboundPage } from './features/inbound/InboundPage';
import { DeliveryDetailPage } from './features/inbound/DeliveryDetailPage';
import { ReceiveDevicesPage } from './features/inbound/ReceiveDevicesPage';
import { InventoryPage } from './features/inventory/InventoryPage';
import { AssetDetailPage } from './features/inventory/AssetDetailPage';
import { AgeingPage } from './features/inventory/AgeingPage';
import { InspectionsPage } from './features/inspections/InspectionsPage';
import { InspectionDetailPage } from './features/inspections/InspectionDetailPage';
import { LedgerPage } from './features/ledger/LedgerPage';
import { RateCardPage } from './features/rate-card/RateCardPage';
import { ClientsPage } from './features/clients/ClientsPage';
import { UsersPage } from './features/users/UsersPage';
import { LocationsPage } from './features/locations/LocationsPage';
import { EndUsersPage } from './features/end-users/EndUsersPage';
import { DeploymentPage } from './features/deployment';
import { RetrievalPage } from './features/retrieval';
import { DisposalPage } from './features/disposal';
import { RepairPage } from './features/repair';
import { ResalePage } from './features/resale/ResalePage';
import { BillingPage } from './features/billing';
import { AuditLogPage } from './features/audit/AuditLogPage';
import { HelpPage } from './features/help';
import { RuralPincodesPage } from './features/logistics/RuralPincodesPage';
import { TicketLookupPage } from './features/ticket-lookup/TicketLookupPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route
                element={
                  <ProtectedRoute>
                    <Layout />
                  </ProtectedRoute>
                }
              >
                <Route index element={<DashboardPage />} />
                <Route path="inbound" element={<InboundPage />} />
                <Route path="inbound/:id" element={<DeliveryDetailPage />} />
                <Route path="inbound/:id/receive" element={<ReceiveDevicesPage />} />
                <Route path="inventory" element={<InventoryPage />} />
                <Route path="inventory/ageing" element={<AgeingPage />} />
                <Route path="inventory/:id" element={<AssetDetailPage />} />
                <Route path="inspections" element={<InspectionsPage />} />
                <Route path="inspections/:id" element={<InspectionDetailPage />} />
                <Route path="ledger" element={<LedgerPage />} />
                <Route path="rate-card" element={<RateCardPage />} />
                <Route path="ticket-lookup" element={<TicketLookupPage />} />
                <Route path="clients" element={<ClientsPage />} />
                <Route path="users" element={<UsersPage />} />
                <Route path="locations" element={<LocationsPage />} />
                <Route path="end-users" element={<EndUsersPage />} />
                <Route path="deployment" element={<DeploymentPage />} />
                <Route path="retrieval" element={<RetrievalPage />} />
                <Route path="disposal" element={<DisposalPage />} />
                <Route path="repair" element={<RepairPage />} />
                <Route path="resale" element={<ResalePage />} />
                <Route path="billing" element={<BillingPage />} />
                <Route path="audit-log" element={<AuditLogPage />} />
                <Route path="rural-pincodes" element={<RuralPincodesPage />} />
                <Route path="help" element={<HelpPage />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
