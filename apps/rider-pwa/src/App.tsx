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
        backgroundColor: '#0c0a09',
        color: '#f5f5f4',
        padding: '20px',
        textAlign: 'center'
      }}>
        <h1>DispatchPay Rider PWA</h1>
        <p style={{ color: '#a8a29e' }}>Mobile-first PWA experience coming soon.</p>
      </div>
    </QueryClientProvider>
  );
}

export default App;
