"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { ErrorBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { apiFetch } from "@/lib/api";
import type { ImportJob, ImportMode, ImportJobStatus, Paginated } from "@/lib/types";

const STATUS_TONE: Record<ImportJobStatus, "neutral" | "success" | "warning" | "danger" | "info"> = {
  queued: "neutral",
  validating: "info",
  parsing: "info",
  normalizing: "info",
  matching: "info",
  importing: "info",
  completed: "success",
  partially_completed: "warning",
  failed: "danger",
  cancelled: "neutral",
};

export default function ImportsPage() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [providerKey, setProviderKey] = useState("");
  const [mode, setMode] = useState<ImportMode>("upsert");
  const [isDryRun, setIsDryRun] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const query = useQuery<Paginated<ImportJob>>({
    queryKey: ["imports"],
    queryFn: () => apiFetch<Paginated<ImportJob>>("/admin/imports?limit=25"),
    refetchInterval: 5000,
  });

  const uploadMutation = useMutation({
    mutationFn: () => {
      const file = fileInputRef.current?.files?.[0];
      if (!file) return Promise.reject(new Error("choose a .csv or .json file first"));
      const form = new FormData();
      form.set("file", file);
      form.set("providerKey", providerKey);
      form.set("mode", mode);
      form.set("isDryRun", String(isDryRun));
      return apiFetch<ImportJob>("/admin/imports", { method: "POST", body: form });
    },
    onSuccess: () => {
      setError(null);
      setProviderKey("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      void queryClient.invalidateQueries({ queryKey: ["imports"] });
    },
    onError: setError,
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Imports</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Upload a CSV/JSON dataset file to run against a registered data provider.
        </p>
      </div>

      {error !== null && <ErrorBanner error={error} />}

      <Card title="New import">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Provider key" hint="e.g. iq_manual, usda_fdc, openfoodfacts">
            <Input value={providerKey} onChange={(e) => setProviderKey(e.target.value)} />
          </Field>
          <Field label="Mode">
            <Select value={mode} onChange={(e) => setMode(e.target.value as ImportMode)}>
              <option value="upsert">upsert</option>
              <option value="create_only">create_only</option>
              <option value="update_existing">update_existing</option>
            </Select>
          </Field>
          <Field label="File (.csv or .json)">
            <input ref={fileInputRef} type="file" accept=".csv,.json" className="text-sm" />
          </Field>
          <Field label="Dry run">
            <label className="flex items-center gap-2 pt-1.5 text-sm">
              <input type="checkbox" checked={isDryRun} onChange={(e) => setIsDryRun(e.target.checked)} />
              validate only, don&apos;t write
            </label>
          </Field>
        </div>
        <Button
          className="mt-3"
          size="sm"
          onClick={() => uploadMutation.mutate()}
          disabled={!providerKey.trim() || uploadMutation.isPending}
        >
          {uploadMutation.isPending ? "Uploading…" : "Start import"}
        </Button>
      </Card>

      <Card>
        {query.isLoading && <Spinner />}
        {query.isError && <ErrorBanner error={query.error} />}
        {query.data && (
          <Table>
            <Thead>
              <Tr>
                <Th>File</Th>
                <Th>Provider</Th>
                <Th>Mode</Th>
                <Th>Dry run</Th>
                <Th>Status</Th>
                <Th>Created</Th>
              </Tr>
            </Thead>
            <Tbody>
              {query.data.items.map((job) => (
                <Tr key={job.id}>
                  <Td>
                    <Link href={`/imports/${job.id}`} className="font-medium text-slate-900 underline dark:text-slate-100">
                      {job.sourceFileName ?? job.id}
                    </Link>
                  </Td>
                  <Td>{job.provider.key}</Td>
                  <Td>{job.mode}</Td>
                  <Td>{job.isDryRun ? "yes" : "no"}</Td>
                  <Td>
                    <Badge tone={STATUS_TONE[job.status]}>{job.status}</Badge>
                  </Td>
                  <Td>{new Date(job.createdAt).toLocaleString()}</Td>
                </Tr>
              ))}
              {query.data.items.length === 0 && (
                <Tr>
                  <Td colSpan={6} className="text-slate-500 dark:text-slate-400">
                    No import jobs yet.
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
