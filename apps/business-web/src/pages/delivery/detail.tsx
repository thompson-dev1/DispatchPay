import { useParams } from 'react-router-dom';
import PageShell from '../../components/ui/page-shell';
import { useDelivery } from '../../hooks/use-deliveries';

function DeliveryDetailPage() {
  const params = useParams();
  const id = params.id || '';
  const delivery = useDelivery(id);

  return (
    <PageShell title="Delivery Detail">
      {delivery.data ? (
        <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(delivery.data, null, 2)}</pre>
      ) : (
        <p>Loading delivery...</p>
      )}
    </PageShell>
  );
}

export default DeliveryDetailPage;
