import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30000,
      retry: 2,
      refetchOnWindowFocus: true,
    },
    mutations: {
      retry: 0,
    },
  },
});

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <div style={{
        fontFamily: 'system-ui, sans-serif',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        backgroundColor: '#09090b',
        color: '#fafafa'
      }}>
        <h1>DispatchPay Business Dashboard</h1>
        <p style={{ color: '#a1a1aa' }}>Clean, modern Stripe/Linear aesthetics coming soon.</p>
      </div>
    </QueryClientProvider>
  );
}

export default App;
