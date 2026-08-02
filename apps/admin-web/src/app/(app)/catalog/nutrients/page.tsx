"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { ErrorBanner } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { apiFetch } from "@/lib/api";
import type { NutrientDefinition } from "@/lib/types";

const UNITS = ["kcal", "kJ", "g", "mg", "µg"] as const;

export default function NutrientsPage() {
  const { can } = useAuth();
  const canWrite = can("foods.write");
  const queryClient = useQueryClient();

  const query = useQuery<NutrientDefinition[]>({
    queryKey: ["nutrient-definitions"],
    queryFn: () => apiFetch<NutrientDefinition[]>("/admin/catalog/nutrients"),
  });

  const [key, setKey] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [unit, setUnit] = useState<(typeof UNITS)[number]>("g");
  const [isCore, setIsCore] = useState(false);
  const [displayOrder, setDisplayOrder] = useState("0");
  const [error, setError] = useState<unknown>(null);

  const upsertMutation = useMutation({
    mutationFn: () =>
      apiFetch<NutrientDefinition>("/admin/catalog/nutrients", {
        method: "POST",
        body: { key, nameEn, nameAr, unit, isCore, displayOrder: Number(displayOrder) },
      }),
    onSuccess: () => {
      setKey("");
      setNameEn("");
      setNameAr("");
      setIsCore(false);
      setDisplayOrder("0");
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["nutrient-definitions"] });
    },
    onError: setError,
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Nutrient definitions</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Canonical per-100g nutrient keys used across the catalog. Posting an existing key updates it.
        </p>
      </div>

      {error !== null && <ErrorBanner error={error} />}

      {canWrite && (
        <Card title="Create / update nutrient">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Key" hint="lowercase snake_case, e.g. protein_g">
              <Input value={key} onChange={(e) => setKey(e.target.value)} />
            </Field>
            <Field label="Name (English)">
              <Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
            </Field>
            <Field label="Name (Arabic)">
              <Input dir="rtl" value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
            </Field>
            <Field label="Unit">
              <Select value={unit} onChange={(e) => setUnit(e.target.value as (typeof UNITS)[number])}>
                {UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Display order">
              <Input type="number" value={displayOrder} onChange={(e) => setDisplayOrder(e.target.value)} />
            </Field>
            <Field label="Core nutrient">
              <label className="flex items-center gap-2 pt-1.5 text-sm">
                <input type="checkbox" checked={isCore} onChange={(e) => setIsCore(e.target.checked)} />
                shown by default on food cards
              </label>
            </Field>
          </div>
          <Button
            className="mt-3"
            size="sm"
            onClick={() => upsertMutation.mutate()}
            disabled={!key.trim() || !nameEn.trim() || !nameAr.trim() || upsertMutation.isPending}
          >
            {upsertMutation.isPending ? "Saving…" : "Save nutrient"}
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
                <Th>Order</Th>
                <Th>Key</Th>
                <Th>Name (EN)</Th>
                <Th>Name (AR)</Th>
                <Th>Unit</Th>
                <Th>Core</Th>
              </Tr>
            </Thead>
            <Tbody>
              {query.data.map((n) => (
                <Tr key={n.id}>
                  <Td>{n.displayOrder}</Td>
                  <Td className="font-mono text-xs">{n.key}</Td>
                  <Td>{n.nameEn}</Td>
                  <Td dir="rtl">{n.nameAr}</Td>
                  <Td>{n.unit}</Td>
                  <Td>{n.isCore && <Badge tone="info">core</Badge>}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
