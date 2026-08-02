"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { ErrorBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Spinner } from "@/components/ui/spinner";
import { API_BASE, apiFetch } from "@/lib/api";
import type { ImportJob } from "@/lib/types";

export default function ImportDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const queryClient = useQueryClient();

  const query = useQuery<ImportJob>({
    queryKey: ["imports", id],
    queryFn: () => apiFetch<ImportJob>(`/admin/imports/${id}`),
    refetchInterval: (q) => {
      const status = q.state.data?.status;
      const inFlight = status && !["completed", "failed", "cancelled", "partially_completed"].includes(status);
      return inFlight ? 3000 : false;
    },
  });

  const [error, setError] = useState<unknown>(null);
  const [cancelOpen, setCancelOpen] = useState(false);

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ["imports", id] });
    void queryClient.invalidateQueries({ queryKey: ["imports"] });
  }

  const retryMutation = useMutation({
    mutationFn: () => apiFetch(`/admin/imports/${id}/retry`, { method: "POST" }),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: setError,
  });

  const cancelMutation = useMutation({
    mutationFn: () => apiFetch(`/admin/imports/${id}/cancel`, { method: "POST" }),
    onSuccess: () => {
      setError(null);
      setCancelOpen(false);
      invalidate();
    },
    onError: (err) => {
      setError(err);
      setCancelOpen(false);
    },
  });

  if (query.isLoading) return <Spinner />;
  if (query.isError) return <ErrorBanner error={query.error} />;
  if (!query.data) return null;

  const job = query.data;
  const canRetry = ["failed", "partially_completed", "cancelled"].includes(job.status);
  const canCancel = !["completed", "failed", "cancelled"].includes(job.status);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">{job.sourceFileName ?? job.id}</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Provider: {job.provider.name} ({job.provider.key})
        </p>
      </div>

      {error !== null && <ErrorBanner error={error} />}

      <Card title="Status">
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-slate-500 dark:text-slate-400">Status</dt>
            <dd>
              <Badge tone={job.status === "completed" ? "success" : job.status === "failed" ? "danger" : "info"}>
                {job.status}
              </Badge>
            </dd>
          </div>
          <div>
            <dt className="text-slate-500 dark:text-slate-400">Mode</dt>
            <dd>{job.mode}</dd>
          </div>
          <div>
            <dt className="text-slate-500 dark:text-slate-400">Dry run</dt>
            <dd>{job.isDryRun ? "yes" : "no"}</dd>
          </div>
          <div>
            <dt className="text-slate-500 dark:text-slate-400">Checkpoint row</dt>
            <dd>{job.checkpointRow}</dd>
          </div>
          <div>
            <dt className="text-slate-500 dark:text-slate-400">Total rows</dt>
            <dd>{job.totalRows ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-slate-500 dark:text-slate-400">Created</dt>
            <dd>{new Date(job.createdAt).toLocaleString()}</dd>
          </div>
          {job.startedAt && (
            <div>
              <dt className="text-slate-500 dark:text-slate-400">Started</dt>
              <dd>{new Date(job.startedAt).toLocaleString()}</dd>
            </div>
          )}
          {job.finishedAt && (
            <div>
              <dt className="text-slate-500 dark:text-slate-400">Finished</dt>
              <dd>{new Date(job.finishedAt).toLocaleString()}</dd>
            </div>
          )}
        </dl>

        {job.stats && (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
            {(["created", "updated", "skipped", "errors", "flaggedDuplicates"] as const).map((k) => (
              <div key={k} className="rounded-md border border-slate-200 px-3 py-2 dark:border-slate-700">
                <div className="text-xs text-slate-500 dark:text-slate-400">{k}</div>
                <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">{job.stats?.[k] ?? 0}</div>
              </div>
            ))}
          </div>
        )}

        {job.errorSummary && <p className="mt-3 text-sm text-red-700 dark:text-red-400">{job.errorSummary}</p>}

        <div className="mt-4 flex flex-wrap gap-2">
          <a href={`${API_BASE}/admin/imports/${id}/errors.csv`} download>
            <Button variant="secondary" size="sm">
              Download error report (CSV)
            </Button>
          </a>
          {canRetry && (
            <Button size="sm" onClick={() => retryMutation.mutate()} disabled={retryMutation.isPending}>
              Retry from checkpoint
            </Button>
          )}
          {canCancel && (
            <Button variant="danger" size="sm" onClick={() => setCancelOpen(true)}>
              Cancel job
            </Button>
          )}
        </div>
      </Card>

      <ConfirmDialog
        open={cancelOpen}
        title="Cancel import job"
        description="The job will stop between chunk batches. Rows already imported are not rolled back."
        confirmLabel="Cancel job"
        danger
        busy={cancelMutation.isPending}
        onCancel={() => setCancelOpen(false)}
        onConfirm={() => cancelMutation.mutate()}
      />
    </div>
  );
}
