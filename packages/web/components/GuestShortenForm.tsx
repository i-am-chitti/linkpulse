'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { shortenGuestSchema } from '@linkpulse/shared';
import type { LinkDto, ShortenGuestInput } from '@linkpulse/shared';
import { apiFetch, ApiError } from '../lib/api';
import { copyToClipboard } from '../lib/clipboard';
import { Button } from './ui/Button';
import { Input } from './ui/Input';

/**
 * PROJECT_SPEC.md section 2.1's guest mode: unauthenticated, 24h expiry, no
 * custom alias - so, unlike CreateLinkForm, just a url field and no options
 * panel. Not wired through TanStack Query: there is no "my links" list for
 * an anonymous caller to invalidate, so a plain apiFetch call plus local
 * state for the result is all this needs.
 */
export function GuestShortenForm() {
  const [result, setResult] = useState<LinkDto | null>(null);
  const [copied, setCopied] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ShortenGuestInput>({ resolver: zodResolver(shortenGuestSchema) });

  async function onSubmit(input: ShortenGuestInput) {
    setFormError(null);
    try {
      const link = await apiFetch<LinkDto>('/api/shorten', { method: 'POST', body: input });
      setResult(link);
      setCopied(false);
      reset();
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : 'Something went wrong.');
    }
  }

  async function handleCopy() {
    if (!result) return;
    await copyToClipboard(result.shortUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={handleSubmit(onSubmit)} className="flex items-start gap-2" noValidate>
        <div className="flex-1">
          <Input
            placeholder="https://example.com/a/very/long/url"
            aria-label="Destination URL"
            {...register('url')}
            error={errors.url?.message}
          />
        </div>
        <Button type="submit" isLoading={isSubmitting}>
          Shorten
        </Button>
      </form>

      {formError && <p className="text-sm text-red-600">{formError}</p>}

      {result && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-gray-200 bg-gray-50 p-3">
          <a
            href={result.shortUrl}
            target="_blank"
            rel="noreferrer"
            className="truncate font-medium text-brand hover:underline"
          >
            {result.shortUrl.replace(/^https?:\/\//, '')}
          </a>
          <Button type="button" variant="secondary" onClick={handleCopy}>
            {copied ? 'Copied!' : 'Copy'}
          </Button>
        </div>
      )}

      <p className="text-xs text-gray-400">
        No account needed - this link expires in 24 hours. Sign up for permanent links, custom
        aliases, and click analytics.
      </p>
    </div>
  );
}
