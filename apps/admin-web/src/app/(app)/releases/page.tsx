"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { ErrorBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { apiFetch } from "@/lib/api";
import type { DatasetRelease, ReleaseStatus } from "@/lib/types";

const STATUS_TONE: Record<ReleaseStatus, "neutral" | "success" | "warning" | "danger" | "info"> = {
  draft: "neutral",
  candidate: "info",
  published: "success",
  rolled_back: "warning",
  archived: "neutral",
};

function defaultVersion(): string {
  const now = new Date();
  return `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, "0")}.0`;
}

export default function ReleasesPage() {
  const queryClient = useQueryClient();
  const [version, setVersion] = useState(defaultVersion());
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<unknown>(null);

  const query = useQuery<DatasetRelease[]>({
    queryKey: ["releases"],
    queryFn: () => apiFetch<DatasetRelease[]>("/admin/releases"),
    refetchInterval: 5000,
  });

  const buildMutation = useMutation({
    mutationFn: () => apiFetch("/admin/releases", { method: "POST", body: { version, notes: notes || undefined } }),
    onSuccess: () => {
      setError(null);
      setNotes("");
      void queryClient.invalidateQueries({ queryKey: ["releases"] });
    },
    onError: setError,
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Dataset releases</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          A release is an immutable, versioned snapshot of verified foods served by the public API.
        </p>
      </div>

      {error !== null && <ErrorBanner error={error} />}

      <Card title="Build a release candidate">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Version (calver, e.g. 2026.08.0)">
            <Input value={version} onChange={(e) => setVersion(e.target.value)} />
          </Field>
          <Field label="Notes">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          Building runs asynchronously on the worker from all currently-verified foods.
        </p>
        <Button
          className="mt-3"
          size="sm"
          onClick={() => buildMutation.mutate()}
          disabled={!version.trim() || buildMutation.isPending}
        >
          {buildMutation.isPending ? "Requesting…" : "Build candidate"}
        </Button>
      </Card>

      <Card>
        {query.isLoading && <Spinner />}
        {query.isError && <ErrorBanner error={query.error} />}
        {query.data && (
          <Table>
            <Thead>
              <Tr>
                <Th>Version</Th>
                <Th>Status</Th>
                <Th>Active</Th>
                <Th>Foods</Th>
                <Th>Created</Th>
              </Tr>
            </Thead>
            <Tbody>
              {query.data.map((r) => (
                <Tr key={r.id}>
                  <Td>
                    <Link href={`/releases/${r.id}`} className="font-medium text-slate-900 underline dark:text-slate-100">
                      {r.version}
                    </Link>
                  </Td>
                  <Td>
                    <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>
                  </Td>
                  <Td>{r.isActive ? <Badge tone="success">active</Badge> : "—"}</Td>
                  <Td>{r.foodCount ?? "—"}</Td>
                  <Td>{new Date(r.createdAt).toLocaleString()}</Td>
                </Tr>
              ))}
              {query.data.length === 0 && (
                <Tr>
                  <Td colSpan={5} className="text-slate-500 dark:text-slate-400">
                    No releases yet.
                  </Td>
                </Tr>
              )}
            </Tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
