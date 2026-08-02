"use client";

import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { ErrorBanner } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { apiFetch } from "@/lib/api";
import type { FailedJob, QueueSummary } from "@/lib/types";

export default function JobsPage() {
  const summary = useQuery<{ queues: QueueSummary[] }>({
    queryKey: ["jobs", "summary"],
    queryFn: () => apiFetch<{ queues: QueueSummary[] }>("/admin/jobs/summary"),
    refetchInterval: 5000,
  });

  const failed = useQuery<FailedJob[]>({
    queryKey: ["jobs", "failed"],
    queryFn: () => apiFetch<FailedJob[]>("/admin/jobs/failed"),
    refetchInterval: 10000,
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Jobs</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">BullMQ queue depths and recent failures.</p>
      </div>

      <Card title="Queue depths">
        {summary.isLoading && <Spinner />}
        {summary.isError && <ErrorBanner error={summary.error} />}
        {summary.data && (
          <Table>
            <Thead>
              <Tr>
                <Th>Queue</Th>
                <Th>Waiting</Th>
                <Th>Active</Th>
                <Th>Delayed</Th>
                <Th>Completed</Th>
                <Th>Failed</Th>
              </Tr>
            </Thead>
            <Tbody>
              {summary.data.queues.map((q) => (
                <Tr key={q.name}>
                  <Td className="font-medium text-slate-900 dark:text-slate-100">{q.name}</Td>
                  <Td>{q.waiting}</Td>
                  <Td>{q.active}</Td>
                  <Td>{q.delayed}</Td>
                  <Td>{q.completed}</Td>
                  <Td>{q.failed > 0 ? <Badge tone="danger">{q.failed}</Badge> : q.failed}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </Card>

      <Card title="Recent failed jobs">
        {failed.isLoading && <Spinner />}
        {failed.isError && <ErrorBanner error={failed.error} />}
        {failed.data && (
          <Table>
            <Thead>
              <Tr>
                <Th>Queue</Th>
                <Th>Job</Th>
                <Th>Reason</Th>
                <Th>When</Th>
              </Tr>
            </Thead>
            <Tbody>
              {failed.data.map((j) => (
                <Tr key={`${j.queue}-${j.id}`}>
                  <Td>{j.queue}</Td>
                  <Td className="font-mono text-xs">{j.name}</Td>
                  <Td className="max-w-md truncate" title={j.failedReason}>
                    {j.failedReason}
                  </Td>
                  <Td>{new Date(j.timestamp).toLocaleString()}</Td>
                </Tr>
              ))}
              {failed.data.length === 0 && (
                <Tr>
                  <Td colSpan={4} className="text-slate-500 dark:text-slate-400">
                    No failed jobs.
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
