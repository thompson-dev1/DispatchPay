import { useQuery } from '@tanstack/react-query';
import { api } from '../services/api-client';

export interface Wallet {
  id: string;
  balanceMinor: number;
  currency: string;
}

export function useBusinessWallet() {
  return useQuery<Wallet>({
    queryKey: ['wallet', 'business'],
    queryFn: async () => {
      const { data } = await api.get('/api/v1/businesses/wallet');
      return data as Wallet;
    },
    staleTime: 10000,
    gcTime: 5 * 60 * 1000,
  });
}
