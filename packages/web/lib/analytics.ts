'use client';

import { useQuery } from '@tanstack/react-query';
import type { LinkAnalytics, LinkAnalyticsSummary } from '@linkpulse/shared';
import { apiFetch } from './api';

export type AnalyticsRange = Partial<Record<'from' | 'to', string>>;

export function useLinkAnalytics(linkId: string, range: AnalyticsRange) {
  return useQuery({
    queryKey: ['links', 'detail', linkId, 'analytics', range],
    queryFn: () => apiFetch<LinkAnalytics>(`/api/links/${linkId}/analytics`, { params: range }),
    enabled: Boolean(linkId),
  });
}

export function useLinkAnalyticsSummary(linkId: string) {
  return useQuery({
    queryKey: ['links', 'detail', linkId, 'analytics', 'summary'],
    queryFn: () => apiFetch<LinkAnalyticsSummary>(`/api/links/${linkId}/analytics/summary`),
    enabled: Boolean(linkId),
  });
}
