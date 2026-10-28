import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';

/**
 * Looks up the state for a 6-digit pincode and hands it to `onState`, so address forms can
 * pre-fill the State field. The user can still overwrite it; it only re-fills when the pincode changes.
 */
export function usePincodeState(pincode: string, onState: (state: string) => void): void {
  const valid = /^\d{6}$/.test(pincode);
  const { data } = useQuery({
    queryKey: ['pincode-state', pincode],
    queryFn: () =>
      api.get<{ state: string | null }>(
        `/logistics/resolve-state?pincode=${encodeURIComponent(pincode)}`,
      ),
    enabled: valid,
    staleTime: Infinity,
    retry: 1,
  });

  const onStateRef = useRef(onState);
  onStateRef.current = onState;

  useEffect(() => {
    if (valid && data?.state) onStateRef.current(data.state);
  }, [valid, data]);
}
