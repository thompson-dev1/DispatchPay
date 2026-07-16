import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api-client';

export interface Payout {
  id: string;
  riderId: string;
  amountMinor: number;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  createdAt: string;
}

export function usePayouts() {
  return useQuery<Payout[]>({
    queryKey: ['payouts'],
    queryFn: async () => {
      const { data } = await api.get('/api/v1/payouts');
      return data as Payout[];
    },
    staleTime: 15000,
    gcTime: 10 * 60 * 1000,
  });
}

export function useRequestPayout() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: { riderId: string; amountMinor: number }) => {
      const { data } = await api.post('/api/v1/payouts/initiate', payload);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payouts'] });
      queryClient.invalidateQueries({ queryKey: ['wallet', 'business'] });
    },
  });
}
