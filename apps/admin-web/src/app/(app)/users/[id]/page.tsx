"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { Badge } from "@/components/ui/badge";
import { ErrorBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { apiFetch } from "@/lib/api";
import { ALL_ROLES } from "@/lib/permissions";
import type { AdminUserDetail } from "@/lib/types";

export default function UserDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const { user: me, can } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery<AdminUserDetail>({
    queryKey: ["users", id],
    queryFn: () => apiFetch<AdminUserDetail>(`/admin/users/${id}`),
  });

  const [selectedRoles, setSelectedRoles] = useState<string[] | null>(null);
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [suspendReason, setSuspendReason] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [mutationError, setMutationError] = useState<unknown>(null);

  const roles = selectedRoles ?? query.data?.roles ?? [];

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ["users", id] });
    void queryClient.invalidateQueries({ queryKey: ["users"] });
  }

  const setRolesMutation = useMutation({
    mutationFn: () => apiFetch(`/admin/users/${id}/roles`, { method: "POST", body: { roles } }),
    onSuccess: () => {
      setMutationError(null);
      setSelectedRoles(null);
      invalidate();
    },
    onError: setMutationError,
  });

  const suspendMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/admin/users/${id}/suspend`, { method: "POST", body: { reason: suspendReason } }),
    onSuccess: () => {
      setMutationError(null);
      setSuspendOpen(false);
      setSuspendReason("");
      invalidate();
    },
    onError: (err) => {
      setMutationError(err);
      setSuspendOpen(false);
    },
  });

  const reactivateMutation = useMutation({
    mutationFn: () => apiFetch(`/admin/users/${id}/reactivate`, { method: "POST" }),
    onSuccess: () => {
      setMutationError(null);
      invalidate();
    },
    onError: setMutationError,
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiFetch(`/admin/users/${id}/delete`, { method: "POST", parseAs: "none" }),
    onSuccess: () => {
      setDeleteOpen(false);
      router.push("/users");
    },
    onError: (err) => {
      setMutationError(err);
      setDeleteOpen(false);
    },
  });

  if (query.isLoading) return <Spinner />;
  if (query.isError) return <ErrorBanner error={query.error} />;
  if (!query.data) return null;

  const u = query.data;
  const isSelf = me?.id === u.id;

  function toggleRole(role: string) {
    const base = selectedRoles ?? u.roles;
    setSelectedRoles(base.includes(role) ? base.filter((r) => r !== role) : [...base, role]);
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">{u.email}</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          User ID: <span className="font-mono">{u.id}</span>
        </p>
      </div>

      {mutationError !== null && <ErrorBanner error={mutationError} />}

      <Card title="Account">
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-slate-500 dark:text-slate-400">Status</dt>
            <dd>
              <Badge tone={u.status === "active" ? "success" : u.status === "suspended" ? "danger" : "neutral"}>
                {u.status}
              </Badge>
            </dd>
          </div>
          <div>
            <dt className="text-slate-500 dark:text-slate-400">Email verified</dt>
            <dd>{u.emailVerifiedAt ? new Date(u.emailVerifiedAt).toLocaleString() : "no"}</dd>
          </div>
          <div>
            <dt className="text-slate-500 dark:text-slate-400">Display name</dt>
            <dd>{u.profile?.displayName ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-slate-500 dark:text-slate-400">Timezone</dt>
            <dd>{u.profile?.timezone ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-slate-500 dark:text-slate-400">Active sessions</dt>
            <dd>{u.activeSessionCount}</dd>
          </div>
          <div>
            <dt className="text-slate-500 dark:text-slate-400">Created</dt>
            <dd>{new Date(u.createdAt).toLocaleString()}</dd>
          </div>
        </dl>

        <div className="mt-4 flex flex-wrap gap-2">
          {can("users.support") && u.status !== "suspended" && u.status !== "deleted" && (
            <Button variant="secondary" size="sm" onClick={() => setSuspendOpen(true)} disabled={isSelf}>
              Suspend
            </Button>
          )}
          {can("users.support") && u.status === "suspended" && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => reactivateMutation.mutate()}
              disabled={reactivateMutation.isPending}
            >
              Reactivate
            </Button>
          )}
          {can("users.manage") && u.status !== "deleted" && (
            <Button variant="danger" size="sm" onClick={() => setDeleteOpen(true)} disabled={isSelf}>
              Delete account
            </Button>
          )}
        </div>
        {isSelf && (
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            You can&apos;t suspend or delete your own account.
          </p>
        )}
      </Card>

      <Card title="Roles">
        <div className="flex flex-wrap gap-3">
          {ALL_ROLES.map((role) => (
            <label key={role} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={roles.includes(role)}
                disabled={!can("users.manage")}
                onChange={() => toggleRole(role)}
              />
              {role}
            </label>
          ))}
        </div>
        {can("users.manage") && (
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              onClick={() => setRolesMutation.mutate()}
              disabled={setRolesMutation.isPending || selectedRoles === null}
            >
              {setRolesMutation.isPending ? "Saving…" : "Save roles"}
            </Button>
            {selectedRoles !== null && (
              <Button variant="ghost" size="sm" onClick={() => setSelectedRoles(null)}>
                Reset
              </Button>
            )}
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={suspendOpen}
        title="Suspend account"
        description="This immediately revokes every active session for this user."
        confirmLabel="Suspend"
        danger
        busy={suspendMutation.isPending}
        onCancel={() => setSuspendOpen(false)}
        onConfirm={() => suspendMutation.mutate()}
      >
        <Field label="Reason">
          <Input value={suspendReason} onChange={(e) => setSuspendReason(e.target.value)} />
        </Field>
      </ConfirmDialog>

      <ConfirmDialog
        open={deleteOpen}
        title="Delete account"
        description="Soft-deletes the account (auditable retention, not a hard delete) and revokes all sessions. This cannot be undone from this screen."
        confirmLabel="Delete"
        danger
        busy={deleteMutation.isPending}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => deleteMutation.mutate()}
      />
    </div>
  );
}
