"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { ErrorBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { apiFetch } from "@/lib/api";
import type { AccountStatus } from "@/lib/types";
import type { Paginated, AdminUserListItem } from "@/lib/types";

function statusTone(status: AccountStatus): "success" | "warning" | "danger" | "neutral" {
  if (status === "active") return "success";
  if (status === "pending_verification") return "warning";
  if (status === "suspended") return "danger";
  return "neutral";
}

export default function UsersPage() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>("");
  const [role, setRole] = useState<string>("");
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [cursorStack, setCursorStack] = useState<string[]>([]);

  const query = useQuery<Paginated<AdminUserListItem>>({
    queryKey: ["users", { q, status, role, cursor }],
    queryFn: () => {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (status) params.set("status", status);
      if (role) params.set("role", role);
      if (cursor) params.set("cursor", cursor);
      params.set("limit", "25");
      return apiFetch<Paginated<AdminUserListItem>>(`/admin/users?${params.toString()}`);
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
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Users</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Search, review roles, and moderate accounts.</p>
      </div>

      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-56">
            <Input
              placeholder="Search by email"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && resetAndSearch()}
            />
          </div>
          <div className="w-44">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Any status</option>
              <option value="pending_verification">Pending verification</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
              <option value="deleted">Deleted</option>
            </Select>
          </div>
          <div className="w-52">
            <Select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="">Any role</option>
              <option value="user">user</option>
              <option value="nutrition_reviewer">nutrition_reviewer</option>
              <option value="data_manager">data_manager</option>
              <option value="support_admin">support_admin</option>
              <option value="super_admin">super_admin</option>
            </Select>
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
                  <Th>Email</Th>
                  <Th>Roles</Th>
                  <Th>Status</Th>
                  <Th>Created</Th>
                </Tr>
              </Thead>
              <Tbody>
                {query.data.items.map((u) => (
                  <Tr key={u.id}>
                    <Td>
                      <Link href={`/users/${u.id}`} className="font-medium text-slate-900 underline dark:text-slate-100">
                        {u.email}
                      </Link>
                    </Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        {u.roles.length === 0 ? (
                          <Badge tone="neutral">user</Badge>
                        ) : (
                          u.roles.map((r) => (
                            <Badge key={r} tone="info">
                              {r}
                            </Badge>
                          ))
                        )}
                      </div>
                    </Td>
                    <Td>
                      <Badge tone={statusTone(u.status)}>{u.status}</Badge>
                    </Td>
                    <Td>{new Date(u.createdAt).toLocaleDateString()}</Td>
                  </Tr>
                ))}
                {query.data.items.length === 0 && (
                  <Tr>
                    <Td className="text-slate-500 dark:text-slate-400" colSpan={4}>
                      No users match these filters.
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
