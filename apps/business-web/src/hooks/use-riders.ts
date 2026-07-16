import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api-client';

export interface Rider {
  id: string;
  firstName: string;
  lastName: string;
  phoneNumber: string;
  momoNetwork: string;
  momoNumber: string;
  businessId: string;
}

export function useRiders() {
  return useQuery<Rider[]>({
    queryKey: ['riders'],
    queryFn: async () => {
      const { data } = await api.get('/api/v1/riders');
      return data as Rider[];
    },
    staleTime: 30000,
    gcTime: 10 * 60 * 1000,
  });
}

export function useRider(id: string) {
  return useQuery<Rider>({
    queryKey: ['rider', id],
    queryFn: async () => {
      const { data } = await api.get(`/api/v1/riders/${id}`);
      return data as Rider;
    },
    enabled: Boolean(id),
  });
}

export function useUpdateRider() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: Partial<Rider> }) => {
      const { data } = await api.patch(`/api/v1/riders/${id}`, payload);
      return data;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['riders'] });
      queryClient.invalidateQueries({ queryKey: ['rider', vars.id] });
    },
  });
}
