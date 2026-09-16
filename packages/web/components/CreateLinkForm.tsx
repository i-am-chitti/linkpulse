'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { customAliasSchema, destinationUrlSchema, futureDateSchema } from '@linkpulse/shared';
import type { CreateLinkInput } from '@linkpulse/shared';
import { ApiError } from '../lib/api';
import { useCreateLink } from '../lib/links';
import { emptyToUndefined } from '../lib/zodHelpers';
import { Button } from './ui/Button';
import { Input } from './ui/Input';

/**
 * Own schema, not createLinkSchema directly: emptyToUndefined normalizes a
 * blank optional field to "not provided" before @linkpulse/shared's rules
 * run, so an untouched field doesn't read as "provided and invalid".
 *
 * expiresAt must become a Date here, in the browser: a datetime-local input
 * has no timezone offset, so it has to parse against the browser's own time
 * zone before serializing - doing that on the server would use the wrong zone.
 */
const formSchema = z.object({
  url: destinationUrlSchema,
  customAlias: z.preprocess(emptyToUndefined, customAliasSchema.optional()),
  expiresAt: z.preprocess(emptyToUndefined, futureDateSchema.optional()),
});

export function CreateLinkForm({ onCreated }: { onCreated?: () => void }) {
  const createLink = useCreateLink();
  const [formError, setFormError] = useState<string | null>(null);
  const [showOptions, setShowOptions] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: { url: '', customAlias: '', expiresAt: '' },
  });

  /**
   * The zodResolver contract: handleSubmit's callback receives the
   * *resolved* output of formSchema, not the raw string field values -
   * customAlias and expiresAt have already been through emptyToUndefined and
   * the shared validators by the time this runs, so no re-parsing is needed.
   */
  async function onSubmit(input: CreateLinkInput) {
    setFormError(null);

    try {
      await createLink.mutateAsync(input);
      reset();
      setShowOptions(false);
      onCreated?.();
    } catch (error) {
      if (error instanceof ApiError) {
        // Field-level errors (a bad url, a taken alias) surface per field on
        // the server too; anything else (a 409, a network failure) gets the
        // form-level banner.
        const detail = error.details?.url?.[0] ?? error.details?.customAlias?.[0];
        setFormError(detail ?? error.message);
      } else {
        setFormError('Something went wrong.');
      }
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-3" noValidate>
      <div className="flex items-start gap-2">
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
      </div>

      <button
        type="button"
        onClick={() => setShowOptions((v) => !v)}
        aria-expanded={showOptions}
        className="inline-flex w-fit items-center gap-1 self-start text-sm text-gray-500 hover:text-gray-700"
      >
        {showOptions ? (
          <ChevronUp className="h-3.5 w-3.5" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5" />
        )}
        {showOptions ? 'Hide options' : 'Custom alias or expiry'}
      </button>

      {showOptions && (
        <div className="grid grid-cols-1 gap-3 rounded-md border border-gray-200 bg-gray-50 p-3 sm:grid-cols-2">
          <Input
            label="Custom alias"
            placeholder="my-link"
            {...register('customAlias')}
            error={errors.customAlias?.message}
          />
          <Input
            label="Expires at"
            type="datetime-local"
            {...register('expiresAt')}
            error={errors.expiresAt?.message}
          />
        </div>
      )}

      {formError && <p className="text-sm text-red-600">{formError}</p>}
    </form>
  );
}
