"use client";

import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { ErrorBanner } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { apiFetch, serverFetch } from "@/lib/api";
import type { HealthReady, SystemMedia, SystemOverview } from "@/lib/types";

export default function SystemPage() {
  const overview = useQuery<SystemOverview>({
    queryKey: ["system", "overview"],
    queryFn: () => apiFetch<SystemOverview>("/admin/system/overview"),
  });
  const media = useQuery<SystemMedia>({
    queryKey: ["system", "media"],
    queryFn: () => apiFetch<SystemMedia>("/admin/system/media"),
  });
  const health = useQuery<HealthReady>({
    queryKey: ["health", "ready"],
    queryFn: () => serverFetch<HealthReady>("/health/ready"),
    retry: false,
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">System</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Dependency health, dataset counts, and media storage.</p>
      </div>

      <Card title="Dependency health (/health/ready)">
        {health.isLoading && <Spinner />}
        {health.isError && <ErrorBanner error={health.error} />}
        {health.data && (
          <div className="flex flex-wrap gap-2">
            {Object.entries(health.data.checks).map(([name, check]) => (
              <Badge key={name} tone={check.status === "ok" ? "success" : "danger"}>
                {name}: {check.status}
                {check.error ? ` — ${check.error}` : ""}
              </Badge>
            ))}
          </div>
        )}
      </Card>

      <Card title="Overview">
        {overview.isLoading && <Spinner />}
        {overview.isError && <ErrorBanner error={overview.error} />}
        {overview.data && (
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-slate-500 dark:text-slate-400">Users</dt>
              <dd>
                {overview.data.users.active} active / {overview.data.users.total} total
              </dd>
            </div>
            <div>
              <dt className="text-slate-500 dark:text-slate-400">Foods</dt>
              <dd>{overview.data.catalog.totalFoods}</dd>
            </div>
            <div>
              <dt className="text-slate-500 dark:text-slate-400">Needs review</dt>
              <dd>{overview.data.catalog.needsReview}</dd>
            </div>
            <div>
              <dt className="text-slate-500 dark:text-slate-400">Published (active release)</dt>
              <dd>{overview.data.catalog.publishedInActiveRelease}</dd>
            </div>
            <div>
              <dt className="text-slate-500 dark:text-slate-400">Active release</dt>
              <dd>{overview.data.activeRelease?.version ?? "none"}</dd>
            </div>
            <div>
              <dt className="text-slate-500 dark:text-slate-400">Pending media</dt>
              <dd>{overview.data.pendingMediaAssets}</dd>
            </div>
          </dl>
        )}
      </Card>

      <Card title="Media / storage">
        {media.isLoading && <Spinner />}
        {media.isError && <ErrorBanner error={media.error} />}
        {media.data && (
          <>
            <div className="mb-3 flex gap-2">
              <Badge tone="warning">pending: {media.data.pendingCount}</Badge>
              <Badge tone="danger">rejected: {media.data.rejectedCount}</Badge>
            </div>
            <Table>
              <Thead>
                <Tr>
                  <Th>Bucket / key</Th>
                  <Th>Kind</Th>
                  <Th>Content type</Th>
                  <Th>Status</Th>
                  <Th>Created</Th>
                </Tr>
              </Thead>
              <Tbody>
                {media.data.items.map((asset) => (
                  <Tr key={asset.id}>
                    <Td className="max-w-xs truncate font-mono text-xs">
                      {asset.bucket}/{asset.key}
                    </Td>
                    <Td>{asset.kind}</Td>
                    <Td>{asset.contentType}</Td>
                    <Td>
                      <Badge tone={asset.status === "ready" ? "success" : asset.status === "rejected" ? "danger" : "warning"}>
                        {asset.status}
                      </Badge>
                    </Td>
                    <Td>{new Date(asset.createdAt).toLocaleString()}</Td>
                  </Tr>
                ))}
                {media.data.items.length === 0 && (
                  <Tr>
                    <Td colSpan={5} className="text-slate-500 dark:text-slate-400">
                      No media assets yet.
                    </Td>
                  </Tr>
                )}
              </Tbody>
            </Table>
          </>
        )}
      </Card>
    </div>
  );
}
