'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Copy, ExternalLink, Trash2 } from 'lucide-react';
import type { LinkDto } from '@linkpulse/shared';
import { copyToClipboard } from '../lib/clipboard';
import { useDeleteLink, useUpdateLink } from '../lib/links';
import { Button } from './ui/Button';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await copyToClipboard(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center gap-1 text-gray-400 hover:text-gray-700"
      aria-label="Copy short URL"
      title="Copy short URL"
    >
      {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
    </button>
  );
}

/**
 * Requires a second click to actually delete, rather than a browser
 * `confirm()` dialog - a modal confirm blocks the whole tab and looks jarring
 * against everything else here being inline. Reverts on its own after a few
 * seconds so a stray click elsewhere does not leave a link "armed" to delete.
 */
function DeleteButton({ onConfirm, isPending }: { onConfirm: () => void; isPending: boolean }) {
  const [armed, setArmed] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    },
    [],
  );

  function handleClick() {
    if (!armed) {
      setArmed(true);
      timeoutRef.current = setTimeout(() => setArmed(false), 4000);
      return;
    }
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setArmed(false);
    onConfirm();
  }

  return (
    <Button
      type="button"
      variant={armed ? 'danger' : 'ghost'}
      onClick={handleClick}
      isLoading={isPending}
      // Icon-only when unarmed, so it needs its own label rather than
      // relying on visible text - the same gap the Input component had
      // until its label wasn't linked to the field it described.
      aria-label={armed ? 'Confirm delete' : 'Delete link'}
      className="!px-2 !py-1 text-xs"
    >
      <Trash2 className="h-3.5 w-3.5" />
      {armed ? 'Confirm?' : ''}
    </Button>
  );
}

export function LinksTable({ links }: { links: LinkDto[] }) {
  const updateLink = useUpdateLink();
  const deleteLink = useDeleteLink();

  if (links.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-gray-500">
        No links yet. Shorten your first URL above.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
            <th className="py-2 pr-4 font-medium">Short link</th>
            <th className="py-2 pr-4 font-medium">Destination</th>
            <th className="py-2 pr-4 font-medium">Clicks</th>
            <th className="py-2 pr-4 font-medium">Created</th>
            <th className="py-2 pr-4 font-medium">Status</th>
            <th className="py-2 pr-2 font-medium" />
          </tr>
        </thead>
        <tbody>
          {links.map((link) => (
            <tr key={link.id} className="border-b border-gray-100 last:border-0">
              <td className="max-w-[14rem] py-3 pr-4">
                <div className="flex items-center gap-1.5">
                  <a
                    href={link.shortUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="truncate font-medium text-brand hover:underline"
                  >
                    {link.shortUrl.replace(/^https?:\/\//, '')}
                  </a>
                  <CopyButton text={link.shortUrl} />
                </div>
              </td>
              <td className="max-w-xs py-3 pr-4">
                <span className="block truncate text-gray-600" title={link.originalUrl}>
                  {link.originalUrl}
                </span>
              </td>
              <td className="py-3 pr-4 tabular-nums text-gray-900">{link.clickCount}</td>
              <td className="py-3 pr-4 whitespace-nowrap text-gray-500">
                {formatDate(link.createdAt)}
              </td>
              <td className="py-3 pr-4">
                <button
                  type="button"
                  onClick={() =>
                    updateLink.mutate({ id: link.id, patch: { isActive: !link.isActive } })
                  }
                  className={
                    link.isActive
                      ? 'rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700'
                      : 'rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500'
                  }
                >
                  {link.isActive ? 'Active' : 'Disabled'}
                </button>
              </td>
              <td className="py-3 pr-2">
                <div className="flex items-center justify-end gap-1">
                  <a
                    href={`/dashboard/links/${link.id}`}
                    className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                    aria-label="View analytics"
                    title="View analytics"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                  <DeleteButton
                    isPending={deleteLink.isPending}
                    onConfirm={() => deleteLink.mutate(link.id)}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
