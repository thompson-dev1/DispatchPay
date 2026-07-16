import PageShell from '../components/ui/page-shell';
import { useDeliveries } from '../hooks/use-deliveries';
import { useBusinessWallet } from '../hooks/use-wallet';

function DashboardPage() {
  const wallet = useBusinessWallet();
  const deliveries = useDeliveries();

  return (
    <PageShell title="Dashboard">
      <p>
        Wallet: {wallet.data ? `${wallet.data.balanceMinor} ${wallet.data.currency}` : 'Loading...'}
      </p>
      <p>Active deliveries: {deliveries.data ? deliveries.data.length : 'Loading...'}</p>
    </PageShell>
  );
}

export default DashboardPage;
