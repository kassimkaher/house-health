"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { ErrorBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { apiFetch } from "@/lib/api";
import type { DuplicateCandidate } from "@/lib/types";

export default function DuplicatesPage() {
  const queryClient = useQueryClient();
  const [threshold, setThreshold] = useState("0.6");
  const [mergeTarget, setMergeTarget] = useState<DuplicateCandidate | null>(null);
  const [direction, setDirection] = useState<"a-to-b" | "b-to-a">("a-to-b");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<unknown>(null);

  const query = useQuery<DuplicateCandidate[]>({
    queryKey: ["duplicates", threshold],
    queryFn: () => apiFetch<DuplicateCandidate[]>(`/admin/catalog/duplicates?threshold=${threshold}&limit=50`),
  });

  const mergeMutation = useMutation({
    mutationFn: () => {
      if (!mergeTarget) return Promise.reject(new Error("no candidate selected"));
      const sourceFoodId = direction === "a-to-b" ? mergeTarget.foodIdA : mergeTarget.foodIdB;
      const targetFoodId = direction === "a-to-b" ? mergeTarget.foodIdB : mergeTarget.foodIdA;
      return apiFetch(`/admin/catalog/duplicates/merge`, {
        method: "POST",
        body: { sourceFoodId, targetFoodId, notes: notes || undefined },
      });
    },
    onSuccess: () => {
      setMergeTarget(null);
      setNotes("");
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["duplicates"] });
    },
    onError: (err) => {
      setError(err);
      setMergeTarget(null);
    },
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Duplicate review</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Candidate pairs ranked by name similarity. Merging archives the source food and reassigns its aliases,
          barcodes, portions, and source records onto the target — never a hard delete.
        </p>
      </div>

      {error !== null && <ErrorBanner error={error} />}

      <Card>
        <div className="flex items-end gap-3">
          <Field label="Similarity threshold (0.3–1.0)">
            <Input
              className="w-32"
              type="number"
              min={0.3}
              max={1}
              step={0.05}
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
            />
          </Field>
        </div>
      </Card>

      <Card>
        {query.isLoading && <Spinner />}
        {query.isError && <ErrorBanner error={query.error} />}
        {query.data && (
          <Table>
            <Thead>
              <Tr>
                <Th>Food A</Th>
                <Th>Food B</Th>
                <Th>Similarity</Th>
                <Th>Actions</Th>
              </Tr>
            </Thead>
            <Tbody>
              {query.data.map((d) => (
                <Tr key={`${d.foodIdA}-${d.foodIdB}`}>
                  <Td>
                    <Link href={`/catalog/foods/${d.foodIdA}`} className="underline">
                      {d.nameEnA}
                    </Link>
                  </Td>
                  <Td>
                    <Link href={`/catalog/foods/${d.foodIdB}`} className="underline">
                      {d.nameEnB}
                    </Link>
                  </Td>
                  <Td>{(d.similarity * 100).toFixed(0)}%</Td>
                  <Td>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setMergeTarget(d);
                          setDirection("a-to-b");
                        }}
                      >
                        Merge A→B
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setMergeTarget(d);
                          setDirection("b-to-a");
                        }}
                      >
                        Merge B→A
                      </Button>
                    </div>
                  </Td>
                </Tr>
              ))}
              {query.data.length === 0 && (
                <Tr>
                  <Td colSpan={4} className="text-slate-500 dark:text-slate-400">
                    No candidate duplicates at this threshold.
                  </Td>
                </Tr>
              )}
            </Tbody>
          </Table>
        )}
      </Card>

      <ConfirmDialog
        open={mergeTarget !== null}
        title="Merge foods"
        description={
          mergeTarget
            ? `"${direction === "a-to-b" ? mergeTarget.nameEnA : mergeTarget.nameEnB}" will be archived and merged into "${direction === "a-to-b" ? mergeTarget.nameEnB : mergeTarget.nameEnA}". This cannot be undone.`
            : undefined
        }
        confirmLabel="Merge"
        danger
        busy={mergeMutation.isPending}
        onCancel={() => setMergeTarget(null)}
        onConfirm={() => mergeMutation.mutate()}
      >
        <Field label="Notes (optional)">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </ConfirmDialog>
    </div>
  );
}
