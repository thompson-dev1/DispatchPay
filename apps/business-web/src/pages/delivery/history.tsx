import PageShell from '../../components/ui/page-shell';
import { useDeliveries } from '../../hooks/use-deliveries';

function DeliveryHistoryPage() {
  const deliveries = useDeliveries();

  return (
    <PageShell title="Delivery History">
      {deliveries.data ? (
        <ul>
          {deliveries.data.map((delivery) => (
            <li key={delivery.id}>
              {delivery.trackingNumber} - {delivery.status}
            </li>
          ))}
        </ul>
      ) : (
        <p>Loading history...</p>
      )}
    </PageShell>
  );
}

export default DeliveryHistoryPage;
