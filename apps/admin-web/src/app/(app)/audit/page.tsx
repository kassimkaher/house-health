"use client";

import { useQuery } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { ErrorBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { apiFetch } from "@/lib/api";
import type { AuditLogEntry, Paginated } from "@/lib/types";

export default function AuditPage() {
  const [entityType, setEntityType] = useState("");
  const [entityId, setEntityId] = useState("");
  const [action, setAction] = useState("");
  const [actorId, setActorId] = useState("");
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  const query = useQuery<Paginated<AuditLogEntry>>({
    queryKey: ["audit", { entityType, entityId, action, actorId, cursor }],
    queryFn: () => {
      const params = new URLSearchParams();
      if (entityType) params.set("entityType", entityType);
      if (entityId) params.set("entityId", entityId);
      if (action) params.set("action", action);
      if (actorId) params.set("actorId", actorId);
      if (cursor) params.set("cursor", cursor);
      params.set("limit", "50");
      return apiFetch<Paginated<AuditLogEntry>>(`/admin/audit?${params.toString()}`);
    },
  });

  function resetAndSearch() {
    setCursor(undefined);
    setCursorStack([]);
  }
  function nextPage() {
    if (!query.data?.nextCursor) return;
    setCursorStack((s) => [...s, cursor ?? ""]);
    setCursor(query.data.nextCursor);
  }
  function prevPage() {
    setCursorStack((s) => {
      const copy = [...s];
      const prev = copy.pop();
      setCursor(prev || undefined);
      return copy;
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Audit log</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Append-only trail of every admin mutation.</p>
      </div>

      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-40">
            <Input placeholder="Entity type" value={entityType} onChange={(e) => setEntityType(e.target.value)} />
          </div>
          <div className="w-56">
            <Input placeholder="Entity ID" value={entityId} onChange={(e) => setEntityId(e.target.value)} />
          </div>
          <div className="w-40">
            <Input placeholder="Action" value={action} onChange={(e) => setAction(e.target.value)} />
          </div>
          <div className="w-56">
            <Input placeholder="Actor ID" value={actorId} onChange={(e) => setActorId(e.target.value)} />
          </div>
          <Button variant="secondary" onClick={resetAndSearch}>
            Apply filters
          </Button>
        </div>
      </Card>

      <Card>
        {query.isLoading && <Spinner />}
        {query.isError && <ErrorBanner error={query.error} />}
        {query.data && (
          <>
            <Table>
              <Thead>
                <Tr>
                  <Th>When</Th>
                  <Th>Action</Th>
                  <Th>Entity</Th>
                  <Th>Actor</Th>
                </Tr>
              </Thead>
              <Tbody>
                {query.data.items.map((entry) => (
                  <Fragment key={entry.id}>
                    <Tr onClick={() => setExpanded(expanded === entry.id ? null : entry.id)}>
                      <Td className="whitespace-nowrap">{new Date(entry.createdAt).toLocaleString()}</Td>
                      <Td className="font-mono text-xs">{entry.action}</Td>
                      <Td>
                        {entry.entityType}
                        {entry.entityId ? `: ${entry.entityId}` : ""}
                      </Td>
                      <Td className="font-mono text-xs">{entry.actorId ?? "system"}</Td>
                    </Tr>
                    {expanded === entry.id && (
                      <Tr>
                        <Td colSpan={4}>
                          <div className="grid grid-cols-1 gap-3 rounded-md bg-slate-50 p-3 text-xs sm:grid-cols-2 dark:bg-slate-800/60">
                            <div>
                              <div className="mb-1 font-medium text-slate-700 dark:text-slate-300">Before</div>
                              <pre className="overflow-x-auto whitespace-pre-wrap">
                                {JSON.stringify(entry.before, null, 2) ?? "null"}
                              </pre>
                            </div>
                            <div>
                              <div className="mb-1 font-medium text-slate-700 dark:text-slate-300">After</div>
                              <pre className="overflow-x-auto whitespace-pre-wrap">
                                {JSON.stringify(entry.after, null, 2) ?? "null"}
                              </pre>
                            </div>
                          </div>
                        </Td>
                      </Tr>
                    )}
                  </Fragment>
                ))}
                {query.data.items.length === 0 && (
                  <Tr>
                    <Td colSpan={4} className="text-slate-500 dark:text-slate-400">
                      No audit entries match these filters.
                    </Td>
                  </Tr>
                )}
              </Tbody>
            </Table>
            <div className="mt-3 flex items-center justify-between">
              <Button variant="secondary" size="sm" onClick={prevPage} disabled={cursorStack.length === 0}>
                Previous
              </Button>
              <Button variant="secondary" size="sm" onClick={nextPage} disabled={!query.data.nextCursor}>
                Next
              </Button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
