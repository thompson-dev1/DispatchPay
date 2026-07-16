import PageShell from '../components/ui/page-shell';
import { useRiderDeliveries } from '../hooks/use-deliveries';

function DashboardPage() {
  const deliveries = useRiderDeliveries();

  return (
    <PageShell title="My Deliveries">
      {deliveries.data ? (
        <ul>
          {deliveries.data.map((delivery) => (
            <li key={delivery.id}>
              {delivery.trackingNumber} - {delivery.status}
            </li>
          ))}
        </ul>
      ) : (
        <p>Loading deliveries...</p>
      )}
    </PageShell>
  );
}

export default DashboardPage;
