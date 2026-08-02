"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { ErrorBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { apiFetch } from "@/lib/api";
import type { Brand } from "@/lib/types";

export default function BrandsPage() {
  const { can } = useAuth();
  const canWrite = can("foods.write");
  const queryClient = useQueryClient();

  const query = useQuery<Brand[]>({
    queryKey: ["brands"],
    queryFn: () => apiFetch<Brand[]>("/admin/catalog/brands"),
  });

  const [slug, setSlug] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [manufacturer, setManufacturer] = useState("");
  const [countryCode, setCountryCode] = useState("");
  const [error, setError] = useState<unknown>(null);

  const createMutation = useMutation({
    mutationFn: () =>
      apiFetch<Brand>("/admin/catalog/brands", {
        method: "POST",
        body: {
          slug,
          nameEn,
          nameAr: nameAr || null,
          manufacturer: manufacturer || null,
          countryCode: countryCode || null,
        },
      }),
    onSuccess: () => {
      setSlug("");
      setNameEn("");
      setNameAr("");
      setManufacturer("");
      setCountryCode("");
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["brands"] });
    },
    onError: setError,
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Brands</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Brand registry used by branded foods.</p>
      </div>

      {error !== null && <ErrorBanner error={error} />}

      {canWrite && (
        <Card title="New brand">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Field label="Slug">
              <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="al-safi" />
            </Field>
            <Field label="Name (English)">
              <Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
            </Field>
            <Field label="Name (Arabic)">
              <Input dir="rtl" value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
            </Field>
            <Field label="Manufacturer">
              <Input value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} />
            </Field>
            <Field label="Country code (2-letter)">
              <Input value={countryCode} maxLength={2} onChange={(e) => setCountryCode(e.target.value.toUpperCase())} />
            </Field>
          </div>
          <Button
            className="mt-3"
            size="sm"
            onClick={() => createMutation.mutate()}
            disabled={!slug.trim() || !nameEn.trim() || createMutation.isPending}
          >
            {createMutation.isPending ? "Creating…" : "Create brand"}
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
                <Th>Manufacturer</Th>
                <Th>Country</Th>
              </Tr>
            </Thead>
            <Tbody>
              {query.data.map((b) => (
                <Tr key={b.id}>
                  <Td className="font-medium text-slate-900 dark:text-slate-100">{b.nameEn}</Td>
                  <Td dir="rtl">{b.nameAr ?? "—"}</Td>
                  <Td className="font-mono text-xs">{b.slug}</Td>
                  <Td>{b.manufacturer ?? "—"}</Td>
                  <Td>{b.countryCode ?? "—"}</Td>
                </Tr>
              ))}
              {query.data.length === 0 && (
                <Tr>
                  <Td colSpan={5} className="text-slate-500 dark:text-slate-400">
                    No brands yet.
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
