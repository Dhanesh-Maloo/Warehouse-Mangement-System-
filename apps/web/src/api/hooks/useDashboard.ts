import { useQuery } from '@tanstack/react-query';
import { api } from '../client';

interface InventorySummary {
  receiving: number;
  in_inspection: number;
  in_storage: number;
  deployed: number;
  returning: number;
  disposed: number;
}

export function useInventorySummary(clientId?: string) {
  return useQuery({
    queryKey: ['inventory-summary', clientId],
    queryFn: () =>
      api.get<InventorySummary>(`/inventory/summary${clientId ? `?clientId=${clientId}` : ''}`),
  });
}
