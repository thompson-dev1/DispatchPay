import PageShell from '../../components/ui/page-shell';
import { useRiders } from '../../hooks/use-riders';

function RidersPage() {
  const riders = useRiders();

  return (
    <PageShell title="Riders">
      {riders.data ? (
        <ul>
          {riders.data.map((rider) => (
            <li key={rider.id}>
              {rider.firstName} {rider.lastName} - {rider.phoneNumber}
            </li>
          ))}
        </ul>
      ) : (
        <p>Loading riders...</p>
      )}
    </PageShell>
  );
}

export default RidersPage;
