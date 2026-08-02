"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useAuth } from "@/components/auth-provider";
import { Badge } from "@/components/ui/badge";
import { ErrorBanner } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { apiFetch, serverFetch } from "@/lib/api";
import type { HealthReady, SystemOverview } from "@/lib/types";

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
      <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-100">{value}</div>
    </div>
  );
}

export default function DashboardPage() {
  const { can } = useAuth();
  const canSeeOverview = can("system.admin");

  const overview = useQuery<SystemOverview>({
    queryKey: ["system", "overview"],
    queryFn: () => apiFetch<SystemOverview>("/admin/system/overview"),
    enabled: canSeeOverview,
  });

  const health = useQuery<HealthReady>({
    queryKey: ["health", "ready"],
    queryFn: () => serverFetch<HealthReady>("/health/ready"),
    retry: false,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Dashboard</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Platform status at a glance.</p>
      </div>

      <Card title="Dependency health">
        {health.isLoading && <Spinner />}
        {health.isError && <ErrorBanner error={health.error} />}
        {health.data && (
          <div className="flex flex-wrap gap-2">
            {Object.entries(health.data.checks).map(([name, check]) => (
              <Badge key={name} tone={check.status === "ok" ? "success" : "danger"}>
                {name}: {check.status}
              </Badge>
            ))}
          </div>
        )}
      </Card>

      {!canSeeOverview && (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          You don&apos;t have the <code>system.admin</code> permission, so dashboard counts aren&apos;t shown. Use the
          sidebar to jump to a section you have access to.
        </p>
      )}

      {canSeeOverview && (
        <>
          {overview.isLoading && <Spinner />}
          {overview.isError && <ErrorBanner error={overview.error} />}
          {overview.data && (
            <>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                <Stat label="Total users" value={overview.data.users.total} />
                <Stat label="Active users" value={overview.data.users.active} />
                <Stat label="Total foods" value={overview.data.catalog.totalFoods} />
                <Stat label="Needs review" value={overview.data.catalog.needsReview} />
                <Stat label="Published (active release)" value={overview.data.catalog.publishedInActiveRelease} />
                <Stat label="Pending media assets" value={overview.data.pendingMediaAssets} />
              </div>

              <Card title="Active dataset release">
                {overview.data.activeRelease ? (
                  <div className="text-sm text-slate-700 dark:text-slate-300">
                    <div>
                      Version <span className="font-medium">{overview.data.activeRelease.version}</span>
                    </div>
                    <div>Foods: {overview.data.activeRelease.foodCount ?? "—"}</div>
                    <div>Published: {overview.data.activeRelease.publishedAt ?? "—"}</div>
                  </div>
                ) : (
                  <p className="text-sm text-slate-500 dark:text-slate-400">No active release yet.</p>
                )}
                <Link href="/releases" className="mt-2 inline-block text-sm text-slate-900 underline dark:text-slate-100">
                  Manage releases →
                </Link>
              </Card>

              <Card title="Recent import jobs">
                {overview.data.recentImportJobs.length === 0 ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400">No import jobs yet.</p>
                ) : (
                  <ul className="space-y-1 text-sm text-slate-700 dark:text-slate-300">
                    {overview.data.recentImportJobs.map((job) => (
                      <li key={job.id} className="flex items-center justify-between">
                        <span>
                          {job.mode} — {new Date(job.createdAt).toLocaleString()}
                        </span>
                        <Badge tone={job.status === "completed" ? "success" : job.status === "failed" ? "danger" : "info"}>
                          {job.status}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
                <Link href="/imports" className="mt-2 inline-block text-sm text-slate-900 underline dark:text-slate-100">
                  Manage imports →
                </Link>
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}
