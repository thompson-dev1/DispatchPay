import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api-client';

export interface RiderDelivery {
  id: string;
  trackingNumber: string;
  status: 'PENDING' | 'ASSIGNED' | 'PICKED_UP' | 'DELIVERED' | 'CANCELLED';
  pickupAddress: string;
  deliveryAddress: string;
}

export function useRiderDeliveries() {
  return useQuery<RiderDelivery[]>({
    queryKey: ['rider-deliveries'],
    queryFn: async () => {
      const { data } = await api.get('/api/v1/deliveries');
      return (data as RiderDelivery[]).filter((d) => d.status !== 'PENDING' && d.status !== 'CANCELLED');
    },
    staleTime: 5000,
    gcTime: 5 * 60 * 1000,
  });
}

export function useUpdateDeliveryStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'PICKED_UP' | 'DELIVERED' }) => {
      const { data } = await api.patch(`/api/v1/deliveries/${id}/status`, { status });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rider-deliveries'] });
    },
  });
}
