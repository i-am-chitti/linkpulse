'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateLinkInput,
  LinkDto,
  ListLinksQuery,
  Paginated,
  UpdateLinkInput,
} from '@linkpulse/shared';
import { apiFetch } from './api';

/**
 * One query key root for every links list, regardless of page/search/filter.
 * A mutation invalidates this whole family rather than guessing which exact
 * variant of the list is currently on screen.
 */
const linksKey = {
  all: ['links'] as const,
  list: (query: Partial<ListLinksQuery>) => ['links', 'list', query] as const,
  detail: (id: string) => ['links', 'detail', id] as const,
};

export function useLinks(query: Partial<ListLinksQuery>) {
  return useQuery({
    queryKey: linksKey.list(query),
    queryFn: () => apiFetch<Paginated<LinkDto>>('/api/links', { params: query }),
    // Keeps the current page's rows visible while a new page/search loads,
    // instead of the table flashing empty between requests.
    placeholderData: (previous) => previous,
  });
}

export function useLink(id: string) {
  return useQuery({
    queryKey: linksKey.detail(id),
    queryFn: () => apiFetch<LinkDto>(`/api/links/${id}`),
    enabled: Boolean(id),
  });
}

export function useCreateLink() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateLinkInput) =>
      apiFetch<LinkDto>('/api/links', { method: 'POST', body: input }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: linksKey.all });
    },
  });
}

export function useUpdateLink() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateLinkInput }) =>
      apiFetch<LinkDto>(`/api/links/${id}`, { method: 'PATCH', body: patch }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: linksKey.all });
    },
  });
}

export function useDeleteLink() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/api/links/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: linksKey.all });
    },
  });
}
