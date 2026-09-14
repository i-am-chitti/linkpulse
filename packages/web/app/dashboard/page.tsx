'use client';

import { useState } from 'react';
import { Search } from 'lucide-react';
import { CreateLinkForm } from '../../components/CreateLinkForm';
import { StatusFilter } from '../../components/StatusFilter';
import type { StatusFilterValue } from '../../components/StatusFilter';
import { LinksTable } from '../../components/LinksTable';
import { Pagination } from '../../components/Pagination';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { useLinks } from '../../lib/links';

const PAGE_SIZE = 10;

export default function DashboardPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilterValue>('all');
  const debouncedSearch = useDebouncedValue(search);

  const { data, isLoading, isError } = useLinks({
    page,
    pageSize: PAGE_SIZE,
    search: debouncedSearch || undefined,
    isActive: status === 'all' ? undefined : status === 'active',
  });

  function handleStatusChange(value: StatusFilterValue) {
    setStatus(value);
    setPage(1);
  }

  function handleSearchChange(value: string) {
    setSearch(value);
    setPage(1); // A new search always starts back at page 1.
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Your links</h1>
        <p className="mt-1 text-gray-600">Shorten a URL and track who clicks it.</p>
      </div>

      <Card>
        <CreateLinkForm onCreated={() => setPage(1)} />
      </Card>

      <Card>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-gray-400" />
            <Input
              aria-label="Search links"
              placeholder="Search by code or destination…"
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="w-full max-w-xs"
            />
          </div>
          <StatusFilter value={status} onChange={handleStatusChange} />
        </div>

        {isLoading && <p className="py-10 text-center text-sm text-gray-500">Loading…</p>}
        {isError && (
          <p className="py-10 text-center text-sm text-red-600">
            Couldn&apos;t load your links. Try refreshing.
          </p>
        )}
        {data && (
          <>
            <LinksTable links={data.items} />
            <div className="mt-4">
              <Pagination
                page={data.page}
                totalPages={data.totalPages}
                total={data.total}
                onPageChange={setPage}
              />
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
