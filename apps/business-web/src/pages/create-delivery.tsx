import { FormEvent, useState } from 'react';
import PageShell from '../components/ui/page-shell';
import { useCreateDelivery } from '../hooks/use-deliveries';

function CreateDeliveryPage() {
  const createDelivery = useCreateDelivery();
  const [pickupAddress, setPickupAddress] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [feeAmountMinor, setFeeAmountMinor] = useState(0);
  const [commissionAmountMinor, setCommissionAmountMinor] = useState(0);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    await createDelivery.mutateAsync({
      pickupAddress,
      deliveryAddress,
      feeAmountMinor,
      commissionAmountMinor,
    });
    setPickupAddress('');
    setDeliveryAddress('');
    setFeeAmountMinor(0);
    setCommissionAmountMinor(0);
  };

  return (
    <PageShell title="Create Delivery">
      <form onSubmit={onSubmit} style={{ maxWidth: '480px', display: 'grid', gap: '10px' }}>
        <input value={pickupAddress} onChange={(e) => setPickupAddress(e.target.value)} placeholder="Pickup address" required />
        <input
          value={deliveryAddress}
          onChange={(e) => setDeliveryAddress(e.target.value)}
          placeholder="Delivery address"
          required
        />
        <input
          value={feeAmountMinor}
          min={0}
          onChange={(e) => setFeeAmountMinor(Number(e.target.value))}
          type="number"
          placeholder="Fee (minor units)"
          required
        />
        <input
          value={commissionAmountMinor}
          min={0}
          onChange={(e) => setCommissionAmountMinor(Number(e.target.value))}
          type="number"
          placeholder="Commission (minor units)"
          required
        />
        <button disabled={createDelivery.isPending} type="submit">
          {createDelivery.isPending ? 'Creating...' : 'Create delivery'}
        </button>
      </form>
    </PageShell>
  );
}

export default CreateDeliveryPage;
