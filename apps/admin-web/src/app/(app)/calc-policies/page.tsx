"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import type { CalculationPolicy } from "@/lib/types";

export default function CalcPoliciesPage() {
  const queryClient = useQueryClient();
  const query = useQuery<CalculationPolicy[]>({
    queryKey: ["calc-policies"],
    queryFn: () => apiFetch<CalculationPolicy[]>("/admin/calc-policies"),
  });

  const [key, setKey] = useState("mifflin_st_jeor");
  const [configText, setConfigText] = useState("{}");
  const [notes, setNotes] = useState("");
  const [activate, setActivate] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const createMutation = useMutation({
    mutationFn: () => {
      let config: Record<string, unknown>;
      try {
        config = JSON.parse(configText) as Record<string, unknown>;
      } catch {
        throw new Error("Config must be valid JSON");
      }
      return apiFetch<CalculationPolicy>("/admin/calc-policies", {
        method: "POST",
        body: { key, config, notes: notes || undefined, activate },
      });
    },
    onSuccess: () => {
      setError(null);
      setNotes("");
      void queryClient.invalidateQueries({ queryKey: ["calc-policies"] });
    },
    onError: setError,
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Calculation policies</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Versioned calorie/macro engine configuration. Creating a new version with &quot;activate&quot; deactivates
          the prior active version for the same key.
        </p>
      </div>

      {error !== null && <ErrorBanner error={error} />}

      <Card title="New policy version">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Key">
            <Input value={key} onChange={(e) => setKey(e.target.value)} />
          </Field>
          <Field label="Notes">
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
        <div className="mt-3">
          <Field label="Config (JSON)">
            <Textarea rows={8} className="font-mono text-xs" value={configText} onChange={(e) => setConfigText(e.target.value)} />
          </Field>
        </div>
        <label className="mt-2 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={activate} onChange={(e) => setActivate(e.target.checked)} />
          Activate immediately
        </label>
        <Button
          className="mt-3"
          size="sm"
          onClick={() => createMutation.mutate()}
          disabled={!key.trim() || createMutation.isPending}
        >
          {createMutation.isPending ? "Saving…" : "Create version"}
        </Button>
      </Card>

      <Card>
        {query.isLoading && <Spinner />}
        {query.isError && <ErrorBanner error={query.error} />}
        {query.data && (
          <Table>
            <Thead>
              <Tr>
                <Th>Key</Th>
                <Th>Version</Th>
                <Th>Active</Th>
                <Th>Notes</Th>
                <Th>Created</Th>
              </Tr>
            </Thead>
            <Tbody>
              {query.data.map((p) => (
                <Tr key={p.id}>
                  <Td className="font-mono text-xs">{p.key}</Td>
                  <Td>{p.version}</Td>
                  <Td>{p.isActive && <Badge tone="success">active</Badge>}</Td>
                  <Td className="max-w-xs truncate">{p.notes ?? "—"}</Td>
                  <Td>{new Date(p.createdAt).toLocaleString()}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
