import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createDeliverySchema } from '@dispatchpay/types';
import { z } from 'zod';
import { api } from '../services/api-client';

export interface Delivery {
  id: string;
  trackingNumber: string;
  pickupAddress: string;
  deliveryAddress: string;
  status: 'PENDING' | 'ASSIGNED' | 'PICKED_UP' | 'DELIVERED' | 'CANCELLED';
  feeAmountMinor: number;
  riderId: string | null;
}

export function useDeliveries() {
  return useQuery<Delivery[]>({
    queryKey: ['deliveries'],
    queryFn: async () => {
      const { data } = await api.get('/api/v1/deliveries');
      return data as Delivery[];
    },
    staleTime: 5000,
    gcTime: 5 * 60 * 1000,
  });
}

export function useDelivery(id: string) {
  return useQuery<Delivery>({
    queryKey: ['delivery', id],
    queryFn: async () => {
      const { data } = await api.get(`/api/v1/deliveries/${id}`);
      return data as Delivery;
    },
    enabled: Boolean(id),
    staleTime: 5000,
  });
}

export function useAssignRider() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ deliveryId, riderId }: { deliveryId: string; riderId: string }) => {
      const { data } = await api.patch(`/api/v1/deliveries/${deliveryId}/assign`, { riderId });
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['deliveries'] });
      queryClient.invalidateQueries({ queryKey: ['delivery', variables.deliveryId] });
      queryClient.invalidateQueries({ queryKey: ['riders'] });
    },
  });
}

export function useCreateDelivery() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: z.infer<typeof createDeliverySchema>) => {
      const { data } = await api.post('/api/v1/deliveries', payload);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deliveries'] });
      queryClient.invalidateQueries({ queryKey: ['wallet', 'business'] });
    },
  });
}
