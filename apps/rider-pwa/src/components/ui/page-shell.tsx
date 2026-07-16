import { PropsWithChildren } from 'react';

interface PageShellProps {
  title: string;
}

function PageShell({ title, children }: PropsWithChildren<PageShellProps>) {
  return (
    <main style={{ minHeight: '100vh', padding: '16px', maxWidth: '560px', margin: '0 auto' }}>
      <header style={{ marginBottom: '16px' }}>
        <h1 style={{ margin: 0, fontSize: '1.4rem' }}>{title}</h1>
      </header>
      {children}
    </main>
  );
}

export default PageShell;
