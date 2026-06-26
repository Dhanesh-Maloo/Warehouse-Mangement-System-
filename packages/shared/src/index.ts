// Shared TypeScript types consumed by both apps/api and apps/web.
// Import via the workspace protocol: import { ... } from '@warehouse/shared'

export interface HealthResponse {
  status: 'ok' | 'degraded';
  timestamp: string;
  uptime: number;
  database: 'ok' | 'error';
}
