import { PropsWithChildren } from 'react';
import { useUi } from '../../context/ui.context';

interface PageShellProps {
  title: string;
}

function PageShell({ title, children }: PropsWithChildren<PageShellProps>) {
  const { sidebarOpen, setSidebarOpen } = useUi();

  return (
    <div style={{ minHeight: '100vh', display: 'grid', gridTemplateColumns: sidebarOpen ? '240px 1fr' : '72px 1fr' }}>
      <aside style={{ background: '#111827', color: '#f9fafb', padding: '16px' }}>
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          style={{ marginBottom: '16px', border: 0, borderRadius: '8px', padding: '8px 12px', cursor: 'pointer' }}
        >
          {sidebarOpen ? 'Collapse' : 'Expand'}
        </button>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <a href="/dashboard">Dashboard</a>
          <a href="/create-delivery">Create Delivery</a>
          <a href="/riders">Riders</a>
          <a href="/delivery/history">History</a>
          <a href="/settings">Settings</a>
        </nav>
      </aside>

      <main style={{ padding: '24px' }}>
        <h1 style={{ marginTop: 0 }}>{title}</h1>
        {children}
      </main>
    </div>
  );
}

export default PageShell;
