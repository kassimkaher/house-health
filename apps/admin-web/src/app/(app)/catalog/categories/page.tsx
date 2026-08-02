"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { ErrorBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { apiFetch } from "@/lib/api";
import type { FoodCategory } from "@/lib/types";

export default function CategoriesPage() {
  const { can } = useAuth();
  const canWrite = can("foods.write");
  const queryClient = useQueryClient();

  const query = useQuery<FoodCategory[]>({
    queryKey: ["categories"],
    queryFn: () => apiFetch<FoodCategory[]>("/admin/catalog/categories"),
  });

  const [slug, setSlug] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [parentId, setParentId] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editNameEn, setEditNameEn] = useState("");
  const [editNameAr, setEditNameAr] = useState("");

  const createMutation = useMutation({
    mutationFn: () =>
      apiFetch<FoodCategory>("/admin/catalog/categories", {
        method: "POST",
        body: { slug, nameEn, nameAr, parentId: parentId || null },
      }),
    onSuccess: () => {
      setSlug("");
      setNameEn("");
      setNameAr("");
      setParentId("");
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["categories"] });
    },
    onError: setError,
  });

  const updateMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch<FoodCategory>(`/admin/catalog/categories/${id}`, {
        method: "PATCH",
        body: { nameEn: editNameEn, nameAr: editNameAr },
      }),
    onSuccess: () => {
      setEditingId(null);
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["categories"] });
    },
    onError: setError,
  });

  const categories = query.data ?? [];
  const nameById = Object.fromEntries(categories.map((c) => [c.id, c.nameEn]));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Categories</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Food category tree.</p>
      </div>

      {error !== null && <ErrorBanner error={error} />}

      {canWrite && (
        <Card title="New category">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Slug">
              <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="dairy-products" />
            </Field>
            <Field label="Name (English)">
              <Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
            </Field>
            <Field label="Name (Arabic)">
              <Input dir="rtl" value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
            </Field>
            <Field label="Parent">
              <Select value={parentId} onChange={(e) => setParentId(e.target.value)}>
                <option value="">— top level —</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nameEn}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Button
            className="mt-3"
            size="sm"
            onClick={() => createMutation.mutate()}
            disabled={!slug.trim() || !nameEn.trim() || !nameAr.trim() || createMutation.isPending}
          >
            {createMutation.isPending ? "Creating…" : "Create category"}
          </Button>
        </Card>
      )}

      <Card>
        {query.isLoading && <Spinner />}
        {query.isError && <ErrorBanner error={query.error} />}
        {query.data && (
          <Table>
            <Thead>
              <Tr>
                <Th>Name (EN)</Th>
                <Th>Name (AR)</Th>
                <Th>Slug</Th>
                <Th>Parent</Th>
                {canWrite && <Th>Actions</Th>}
              </Tr>
            </Thead>
            <Tbody>
              {categories.map((c) =>
                editingId === c.id ? (
                  <Tr key={c.id}>
                    <Td>
                      <Input value={editNameEn} onChange={(e) => setEditNameEn(e.target.value)} />
                    </Td>
                    <Td>
                      <Input dir="rtl" value={editNameAr} onChange={(e) => setEditNameAr(e.target.value)} />
                    </Td>
                    <Td>{c.slug}</Td>
                    <Td>{c.parentId ? (nameById[c.parentId] ?? "—") : "—"}</Td>
                    <Td>
                      <div className="flex gap-1">
                        <Button size="sm" onClick={() => updateMutation.mutate(c.id)} disabled={updateMutation.isPending}>
                          Save
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                          Cancel
                        </Button>
                      </div>
                    </Td>
                  </Tr>
                ) : (
                  <Tr key={c.id}>
                    <Td className="font-medium text-slate-900 dark:text-slate-100">{c.nameEn}</Td>
                    <Td dir="rtl">{c.nameAr}</Td>
                    <Td className="font-mono text-xs">{c.slug}</Td>
                    <Td>{c.parentId ? (nameById[c.parentId] ?? "—") : "—"}</Td>
                    {canWrite && (
                      <Td>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            setEditingId(c.id);
                            setEditNameEn(c.nameEn);
                            setEditNameAr(c.nameAr);
                          }}
                        >
                          Edit
                        </Button>
                      </Td>
                    )}
                  </Tr>
                ),
              )}
            </Tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
