import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Navigate, Route, BrowserRouter as Router, Routes } from 'react-router-dom';
import { AuthProvider } from './context/auth.context';
import { UiProvider } from './context/ui.context';
import CreateDeliveryPage from './pages/create-delivery';
import DashboardPage from './pages/dashboard';
import DeliveryDetailPage from './pages/delivery/detail';
import DeliveryHistoryPage from './pages/delivery/history';
import LoginPage from './pages/login';
import RegisterPage from './pages/register';
import RidersPage from './pages/riders';
import SettingsPage from './pages/settings';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30000,
      retry: 2,
      refetchOnWindowFocus: true,
    },
    mutations: {
      // Financial operations must never auto-retry to avoid accidental duplication.
      retry: 0,
    },
  },
});

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <UiProvider>
          <Router>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/create-delivery" element={<CreateDeliveryPage />} />
              <Route path="/delivery/:id" element={<DeliveryDetailPage />} />
              <Route path="/delivery/history" element={<DeliveryHistoryPage />} />
              <Route path="/riders" element={<RidersPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate replace to="/login" />} />
            </Routes>
          </Router>
        </UiProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
