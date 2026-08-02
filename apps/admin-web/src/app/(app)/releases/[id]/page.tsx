"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { ErrorBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Select } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { apiFetch } from "@/lib/api";
import type { DatasetRelease, ReleaseCompareResult } from "@/lib/types";

type Action = "publish" | "rollback" | "archive" | null;

export default function ReleaseDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const queryClient = useQueryClient();

  const query = useQuery<DatasetRelease>({
    queryKey: ["releases", id],
    queryFn: () => apiFetch<DatasetRelease>(`/admin/releases/${id}`),
  });

  const allReleases = useQuery<DatasetRelease[]>({
    queryKey: ["releases"],
    queryFn: () => apiFetch<DatasetRelease[]>("/admin/releases"),
  });

  const [compareId, setCompareId] = useState("");
  const [confirmAction, setConfirmAction] = useState<Action>(null);
  const [error, setError] = useState<unknown>(null);

  const compareQuery = useQuery<ReleaseCompareResult>({
    queryKey: ["releases", id, "compare", compareId],
    queryFn: () => apiFetch<ReleaseCompareResult>(`/admin/releases/${id}/compare/${compareId}`),
    enabled: Boolean(compareId),
  });

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ["releases", id] });
    void queryClient.invalidateQueries({ queryKey: ["releases"] });
  }

  const actionMutation = useMutation({
    mutationFn: (action: Exclude<Action, null>) =>
      apiFetch<DatasetRelease>(`/admin/releases/${id}/${action}`, { method: "POST" }),
    onSuccess: () => {
      setError(null);
      setConfirmAction(null);
      invalidate();
    },
    onError: (err) => {
      setError(err);
      setConfirmAction(null);
    },
  });

  if (query.isLoading) return <Spinner />;
  if (query.isError) return <ErrorBanner error={query.error} />;
  if (!query.data) return null;

  const release = query.data;
  const others = (allReleases.data ?? []).filter((r) => r.id !== id);

  const actionCopy: Record<Exclude<Action, null>, { title: string; description: string; danger: boolean }> = {
    publish: {
      title: "Publish release",
      description: "Atomically activates this release for the public API. Any currently active release is deactivated.",
      danger: false,
    },
    rollback: {
      title: "Roll back to this release",
      description: "Re-activates this (prior) release; the currently active release becomes rolled_back.",
      danger: true,
    },
    archive: {
      title: "Archive release",
      description: "Marks this release as archived. It can no longer be published or rolled back to.",
      danger: true,
    },
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Release {release.version}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">{release.notes ?? "No notes."}</p>
        </div>
        <div className="flex gap-2">
          <Badge tone={release.status === "published" ? "success" : "neutral"}>{release.status}</Badge>
          {release.isActive && <Badge tone="success">active</Badge>}
        </div>
      </div>

      {error !== null && <ErrorBanner error={error} />}

      <Card title="Details">
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-slate-500 dark:text-slate-400">Foods</dt>
            <dd>{release.foodCount ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-slate-500 dark:text-slate-400">Added</dt>
            <dd>{release.addedCount ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-slate-500 dark:text-slate-400">Changed</dt>
            <dd>{release.changedCount ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-slate-500 dark:text-slate-400">Removed</dt>
            <dd>{release.removedCount ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-slate-500 dark:text-slate-400">Published</dt>
            <dd>{release.publishedAt ? new Date(release.publishedAt).toLocaleString() : "—"}</dd>
          </div>
          <div>
            <dt className="text-slate-500 dark:text-slate-400">Rolled back</dt>
            <dd>{release.rolledBackAt ? new Date(release.rolledBackAt).toLocaleString() : "—"}</dd>
          </div>
          <div>
            <dt className="text-slate-500 dark:text-slate-400">Created</dt>
            <dd>{new Date(release.createdAt).toLocaleString()}</dd>
          </div>
        </dl>

        <div className="mt-4 flex flex-wrap gap-2">
          {release.status !== "published" && release.status !== "archived" && (
            <Button size="sm" onClick={() => setConfirmAction("publish")}>
              Publish
            </Button>
          )}
          {!release.isActive && release.status !== "archived" && (
            <Button size="sm" variant="secondary" onClick={() => setConfirmAction("rollback")}>
              Roll back to this
            </Button>
          )}
          {release.status !== "archived" && (
            <Button size="sm" variant="danger" onClick={() => setConfirmAction("archive")}>
              Archive
            </Button>
          )}
        </div>
      </Card>

      <Card title="Compare against another release">
        <div className="mb-3 w-64">
          <Select value={compareId} onChange={(e) => setCompareId(e.target.value)}>
            <option value="">Choose a release…</option>
            {others.map((r) => (
              <option key={r.id} value={r.id}>
                {r.version} ({r.status})
              </option>
            ))}
          </Select>
        </div>
        {compareQuery.isLoading && <Spinner />}
        {compareQuery.isError && <ErrorBanner error={compareQuery.error} />}
        {compareQuery.data && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {(["added", "changed", "removed"] as const).map((key) => {
              const list = Array.isArray(compareQuery.data?.[key]) ? (compareQuery.data![key] as string[]) : [];
              return (
                <div key={key} className="rounded-md border border-slate-200 p-3 dark:border-slate-700">
                  <div className="text-sm font-medium capitalize text-slate-900 dark:text-slate-100">
                    {key} ({list.length})
                  </div>
                  <ul className="mt-1 max-h-40 overflow-y-auto text-xs text-slate-500 dark:text-slate-400">
                    {list.slice(0, 200).map((foodId) => (
                      <li key={foodId} className="truncate font-mono">
                        {foodId}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={confirmAction !== null}
        title={confirmAction ? actionCopy[confirmAction].title : ""}
        description={confirmAction ? actionCopy[confirmAction].description : undefined}
        confirmLabel={confirmAction ?? "Confirm"}
        danger={confirmAction ? actionCopy[confirmAction].danger : false}
        busy={actionMutation.isPending}
        onCancel={() => setConfirmAction(null)}
        onConfirm={() => {
          if (confirmAction) actionMutation.mutate(confirmAction);
        }}
      />
    </div>
  );
}
