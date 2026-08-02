"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { ErrorBanner } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { apiFetch } from "@/lib/api";
import type { AdminFood, FoodType, Paginated, PublicationStatus, ReviewStatus } from "@/lib/types";

const REVIEW_TONE: Record<ReviewStatus, "neutral" | "success" | "warning" | "danger" | "info"> = {
  imported: "neutral",
  normalized: "info",
  needs_review: "warning",
  verified: "success",
  rejected: "danger",
  archived: "neutral",
};

const FOOD_TYPES: FoodType[] = ["generic_food", "branded_product", "prepared_dish", "recipe_template", "user_recipe"];

export default function FoodsPage() {
  const { can } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [q, setQ] = useState("");
  const [reviewStatus, setReviewStatus] = useState("");
  const [publicationStatus, setPublicationStatus] = useState("");
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [cursorStack, setCursorStack] = useState<string[]>([]);

  const query = useQuery<Paginated<AdminFood>>({
    queryKey: ["foods", { q, reviewStatus, publicationStatus, cursor }],
    queryFn: () => {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (reviewStatus) params.set("reviewStatus", reviewStatus);
      if (publicationStatus) params.set("publicationStatus", publicationStatus);
      if (cursor) params.set("cursor", cursor);
      params.set("limit", "25");
      return apiFetch<Paginated<AdminFood>>(`/admin/catalog/foods?${params.toString()}`);
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

  // --- Quick create ---------------------------------------------------------
  const [createOpen, setCreateOpen] = useState(false);
  const [nameAr, setNameAr] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [foodType, setFoodType] = useState<FoodType>("generic_food");
  const [createError, setCreateError] = useState<unknown>(null);

  const createMutation = useMutation({
    mutationFn: () => apiFetch<AdminFood>("/admin/catalog/foods", { method: "POST", body: { nameAr, nameEn, foodType } }),
    onSuccess: (food) => {
      void queryClient.invalidateQueries({ queryKey: ["foods"] });
      setCreateOpen(false);
      setNameAr("");
      setNameEn("");
      router.push(`/catalog/foods/${food.id}`);
    },
    onError: setCreateError,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Foods</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Editorial catalog — search, review, edit.</p>
        </div>
        {can("foods.write") && <Button onClick={() => setCreateOpen(true)}>New food</Button>}
      </div>

      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-56">
            <Input
              placeholder="Search name / alias"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && resetAndSearch()}
            />
          </div>
          <div className="w-48">
            <Select value={reviewStatus} onChange={(e) => setReviewStatus(e.target.value)}>
              <option value="">Any review status</option>
              {(["imported", "normalized", "needs_review", "verified", "rejected", "archived"] as ReviewStatus[]).map(
                (s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ),
              )}
            </Select>
          </div>
          <div className="w-48">
            <Select value={publicationStatus} onChange={(e) => setPublicationStatus(e.target.value)}>
              <option value="">Any publication status</option>
              {(["draft", "published", "deprecated"] as PublicationStatus[]).map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
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
                  <Th>Name (EN)</Th>
                  <Th>Name (AR)</Th>
                  <Th>Type</Th>
                  <Th>Review</Th>
                  <Th>Publication</Th>
                </Tr>
              </Thead>
              <Tbody>
                {query.data.items.map((f) => (
                  <Tr key={f.id} onClick={() => router.push(`/catalog/foods/${f.id}`)}>
                    <Td className="font-medium text-slate-900 dark:text-slate-100">{f.nameEn}</Td>
                    <Td dir="rtl">{f.nameAr}</Td>
                    <Td>{f.foodType}</Td>
                    <Td>
                      <Badge tone={REVIEW_TONE[f.reviewStatus]}>{f.reviewStatus}</Badge>
                    </Td>
                    <Td>
                      <Badge tone={f.publicationStatus === "published" ? "success" : "neutral"}>
                        {f.publicationStatus}
                      </Badge>
                    </Td>
                  </Tr>
                ))}
                {query.data.items.length === 0 && (
                  <Tr>
                    <Td colSpan={5} className="text-slate-500 dark:text-slate-400">
                      No foods match these filters.
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

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} title="New food">
        <div className="space-y-3">
          <Field label="Name (English)">
            <Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
          </Field>
          <Field label="Name (Arabic)">
            <Input dir="rtl" value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
          </Field>
          <Field label="Food type">
            <Select value={foodType} onChange={(e) => setFoodType(e.target.value as FoodType)}>
              {FOOD_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </Field>
          {createError !== null && <ErrorBanner error={createError} />}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending || !nameAr.trim() || !nameEn.trim()}
            >
              {createMutation.isPending ? "Creating…" : "Create"}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
