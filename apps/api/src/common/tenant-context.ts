import { AsyncLocalStorage } from 'async_hooks';

interface TenantStore {
  clientId: string | null;
}

export const tenantStorage = new AsyncLocalStorage<TenantStore>();

export function getTenantId(): string | null {
  return tenantStorage.getStore()?.clientId ?? null;
}
