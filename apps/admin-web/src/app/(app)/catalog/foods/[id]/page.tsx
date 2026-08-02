"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { ErrorBanner } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { apiFetch, ApiError } from "@/lib/api";
import { REVIEW_TRANSITIONS } from "@/lib/food-review";
import type {
  AdminFood,
  AliasKind,
  BarcodeType,
  Brand,
  FoodCategory,
  NutrientDefinition,
  PortionSource,
  PreparationState,
  ReviewStatus,
} from "@/lib/types";

const PREPARATION_STATES: PreparationState[] = [
  "raw",
  "cooked",
  "baked",
  "grilled",
  "fried",
  "steamed",
  "canned",
  "dried",
  "other",
];
const ALIAS_KINDS: AliasKind[] = [
  "iraqi_dialect",
  "msa_variant",
  "english",
  "transliteration",
  "colloquial_other",
  "brand_variant",
];
const BARCODE_TYPES: BarcodeType[] = ["ean13", "ean8", "upc_a", "upc_e", "code128", "other"];
const PORTION_SOURCES: PortionSource[] = ["provider", "curated", "user_submitted", "inferred"];

function tagsToText(tags: string[]): string {
  return tags.join(", ");
}
function textToTags(text: string): string[] {
  return text
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

export default function FoodDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const { can } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery<AdminFood>({
    queryKey: ["foods", id],
    queryFn: () => apiFetch<AdminFood>(`/admin/catalog/foods/${id}`),
  });
  const categoriesQuery = useQuery<FoodCategory[]>({
    queryKey: ["categories"],
    queryFn: () => apiFetch<FoodCategory[]>("/admin/catalog/categories"),
  });
  const brandsQuery = useQuery<Brand[]>({
    queryKey: ["brands"],
    queryFn: () => apiFetch<Brand[]>("/admin/catalog/brands"),
  });
  const nutrientDefsQuery = useQuery<NutrientDefinition[]>({
    queryKey: ["nutrient-definitions"],
    queryFn: () => apiFetch<NutrientDefinition[]>("/admin/catalog/nutrients"),
  });

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ["foods", id] });
    void queryClient.invalidateQueries({ queryKey: ["foods"] });
  }

  return (
    <div className="space-y-4">
      {query.isLoading && <Spinner />}
      {query.isError && <ErrorBanner error={query.error} />}
      {query.data && (
        <FoodEditor
          food={query.data}
          categories={categoriesQuery.data ?? []}
          brands={brandsQuery.data ?? []}
          nutrientDefs={nutrientDefsQuery.data ?? []}
          canWrite={can("foods.write")}
          canReview={can("foods.review")}
          onSaved={invalidate}
          onDeleted={() => router.push("/catalog/foods")}
        />
      )}
    </div>
  );
}

function FoodEditor({
  food,
  categories,
  brands,
  nutrientDefs,
  canWrite,
  canReview,
  onSaved,
  onDeleted,
}: {
  food: AdminFood;
  categories: FoodCategory[];
  brands: Brand[];
  nutrientDefs: NutrientDefinition[];
  canWrite: boolean;
  canReview: boolean;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const [form, setForm] = useState({
    nameAr: food.nameAr,
    nameEn: food.nameEn,
    descriptionAr: food.descriptionAr ?? "",
    descriptionEn: food.descriptionEn ?? "",
    categoryId: food.categoryId ?? "",
    brandId: food.brandId ?? "",
    preparationState: food.preparationState,
    defaultPortionGrams: food.defaultPortionGrams ?? "",
    densityGPerMl: food.densityGPerMl ?? "",
    edibleFraction: food.edibleFraction ?? "",
    marketTags: tagsToText(food.marketTags),
    dietaryTags: tagsToText(food.dietaryTags),
    allergenTags: tagsToText(food.allergenTags),
    dataConfidence: food.dataConfidence,
  });
  const [saveError, setSaveError] = useState<unknown>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Reset the form whenever the server row changes (i.e. after our own saves).
  useEffect(() => {
    setForm({
      nameAr: food.nameAr,
      nameEn: food.nameEn,
      descriptionAr: food.descriptionAr ?? "",
      descriptionEn: food.descriptionEn ?? "",
      categoryId: food.categoryId ?? "",
      brandId: food.brandId ?? "",
      preparationState: food.preparationState,
      defaultPortionGrams: food.defaultPortionGrams ?? "",
      densityGPerMl: food.densityGPerMl ?? "",
      edibleFraction: food.edibleFraction ?? "",
      marketTags: tagsToText(food.marketTags),
      dietaryTags: tagsToText(food.dietaryTags),
      allergenTags: tagsToText(food.allergenTags),
      dataConfidence: food.dataConfidence,
    });
  }, [food.rowVersion]);

  const saveMutation = useMutation({
    mutationFn: () =>
      apiFetch<AdminFood>(`/admin/catalog/foods/${food.id}`, {
        method: "PATCH",
        headers: { "if-match": String(food.rowVersion) },
        body: {
          nameAr: form.nameAr,
          nameEn: form.nameEn,
          descriptionAr: form.descriptionAr || null,
          descriptionEn: form.descriptionEn || null,
          categoryId: form.categoryId || null,
          brandId: form.brandId || null,
          preparationState: form.preparationState,
          defaultPortionGrams: form.defaultPortionGrams === "" ? null : Number(form.defaultPortionGrams),
          densityGPerMl: form.densityGPerMl === "" ? null : Number(form.densityGPerMl),
          edibleFraction: form.edibleFraction === "" ? null : Number(form.edibleFraction),
          marketTags: textToTags(form.marketTags),
          dietaryTags: textToTags(form.dietaryTags),
          allergenTags: textToTags(form.allergenTags),
          dataConfidence: Number(form.dataConfidence),
        },
      }),
    onSuccess: () => {
      setSaveError(null);
      onSaved();
    },
    onError: setSaveError,
  });

  const transitionMutation = useMutation({
    mutationFn: (to: ReviewStatus) =>
      apiFetch<AdminFood>(`/admin/catalog/foods/${food.id}/transition`, { method: "POST", body: { to } }),
    onSuccess: () => {
      setSaveError(null);
      onSaved();
    },
    onError: setSaveError,
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiFetch(`/admin/catalog/foods/${food.id}`, { method: "DELETE", parseAs: "none" }),
    onSuccess: () => onDeleted(),
    onError: (err) => {
      setSaveError(err);
      setDeleteOpen(false);
    },
  });

  const isConflict = saveError instanceof ApiError && saveError.code === "conflict.version";
  const allowedTransitions = REVIEW_TRANSITIONS[food.reviewStatus] ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">{food.nameEn}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            slug: <span className="font-mono">{food.slug}</span> · row v{food.rowVersion}
          </p>
        </div>
        <div className="flex gap-2">
          <Badge tone={food.reviewStatus === "verified" ? "success" : food.reviewStatus === "rejected" ? "danger" : "warning"}>
            {food.reviewStatus}
          </Badge>
          <Badge tone={food.publicationStatus === "published" ? "success" : "neutral"}>{food.publicationStatus}</Badge>
        </div>
      </div>

      {saveError !== null && (
        <ErrorBanner
          error={
            isConflict
              ? new Error("This food was modified elsewhere since you loaded it. Reload the page to see the latest version before saving again.")
              : saveError
          }
        />
      )}

      {canReview && allowedTransitions.length > 0 && (
        <Card title="Review transition">
          <div className="flex flex-wrap gap-2">
            {allowedTransitions.map((to) => (
              <Button
                key={to}
                size="sm"
                variant={to === "rejected" || to === "archived" ? "danger" : "secondary"}
                onClick={() => transitionMutation.mutate(to)}
                disabled={transitionMutation.isPending}
              >
                → {to}
              </Button>
            ))}
          </div>
        </Card>
      )}

      <Card title="Details">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Name (English)">
            <Input
              value={form.nameEn}
              disabled={!canWrite}
              onChange={(e) => setForm((f) => ({ ...f, nameEn: e.target.value }))}
            />
          </Field>
          <Field label="Name (Arabic)">
            <Input
              dir="rtl"
              value={form.nameAr}
              disabled={!canWrite}
              onChange={(e) => setForm((f) => ({ ...f, nameAr: e.target.value }))}
            />
          </Field>
          <Field label="Description (English)">
            <Textarea
              value={form.descriptionEn}
              disabled={!canWrite}
              onChange={(e) => setForm((f) => ({ ...f, descriptionEn: e.target.value }))}
            />
          </Field>
          <Field label="Description (Arabic)">
            <Textarea
              dir="rtl"
              value={form.descriptionAr}
              disabled={!canWrite}
              onChange={(e) => setForm((f) => ({ ...f, descriptionAr: e.target.value }))}
            />
          </Field>
          <Field label="Category">
            <Select
              value={form.categoryId}
              disabled={!canWrite}
              onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}
            >
              <option value="">—</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nameEn}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Brand">
            <Select
              value={form.brandId}
              disabled={!canWrite}
              onChange={(e) => setForm((f) => ({ ...f, brandId: e.target.value }))}
            >
              <option value="">—</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.nameEn}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Preparation state">
            <Select
              value={form.preparationState}
              disabled={!canWrite}
              onChange={(e) => setForm((f) => ({ ...f, preparationState: e.target.value as PreparationState }))}
            >
              {PREPARATION_STATES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Data confidence (0–1)">
            <Input
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={form.dataConfidence}
              disabled={!canWrite}
              onChange={(e) => setForm((f) => ({ ...f, dataConfidence: e.target.value }))}
            />
          </Field>
          <Field label="Default portion (g)">
            <Input
              type="number"
              value={form.defaultPortionGrams}
              disabled={!canWrite}
              onChange={(e) => setForm((f) => ({ ...f, defaultPortionGrams: e.target.value }))}
            />
          </Field>
          <Field label="Density (g/mL)">
            <Input
              type="number"
              value={form.densityGPerMl}
              disabled={!canWrite}
              onChange={(e) => setForm((f) => ({ ...f, densityGPerMl: e.target.value }))}
            />
          </Field>
          <Field label="Edible fraction (0–1)">
            <Input
              type="number"
              min={0}
              max={1}
              step={0.01}
              value={form.edibleFraction}
              disabled={!canWrite}
              onChange={(e) => setForm((f) => ({ ...f, edibleFraction: e.target.value }))}
            />
          </Field>
          <Field label="Market tags (comma-separated)">
            <Input
              value={form.marketTags}
              disabled={!canWrite}
              onChange={(e) => setForm((f) => ({ ...f, marketTags: e.target.value }))}
            />
          </Field>
          <Field label="Dietary tags (comma-separated)">
            <Input
              value={form.dietaryTags}
              disabled={!canWrite}
              onChange={(e) => setForm((f) => ({ ...f, dietaryTags: e.target.value }))}
            />
          </Field>
          <Field label="Allergen tags (comma-separated)">
            <Input
              value={form.allergenTags}
              disabled={!canWrite}
              onChange={(e) => setForm((f) => ({ ...f, allergenTags: e.target.value }))}
            />
          </Field>
        </div>
        {canWrite && (
          <div className="mt-4 flex gap-2">
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? "Saving…" : "Save changes"}
            </Button>
            <Button variant="danger" onClick={() => setDeleteOpen(true)}>
              Delete food
            </Button>
          </div>
        )}
      </Card>

      <NutrientsEditor food={food} nutrientDefs={nutrientDefs} canWrite={canWrite} onSaved={onSaved} />
      <AliasesEditor food={food} canWrite={canWrite} onSaved={onSaved} />
      <BarcodesEditor food={food} canWrite={canWrite} onSaved={onSaved} />
      <PortionsEditor food={food} canWrite={canWrite} onSaved={onSaved} />

      <ConfirmDialog
        open={deleteOpen}
        title="Delete food"
        description="Soft-deletes this food (audit-preserving) and deactivates its barcodes. It will no longer appear in editorial search."
        confirmLabel="Delete"
        danger
        busy={deleteMutation.isPending}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => deleteMutation.mutate()}
      />
    </div>
  );
}

function NutrientsEditor({
  food,
  nutrientDefs,
  canWrite,
  onSaved,
}: {
  food: AdminFood;
  nutrientDefs: NutrientDefinition[];
  canWrite: boolean;
  onSaved: () => void;
}) {
  const initial = Object.fromEntries(food.nutrients.map((n) => [n.nutrient.key, n.valuePer100g]));
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    setValues(Object.fromEntries(food.nutrients.map((n) => [n.nutrient.key, n.valuePer100g])));
  }, [food.rowVersion]);

  const mutation = useMutation({
    mutationFn: () => {
      const nutrients = Object.entries(values)
        .filter(([, v]) => v.trim() !== "")
        .map(([key, v]) => ({ key, valuePer100g: Number(v) }));
      return apiFetch<AdminFood>(`/admin/catalog/foods/${food.id}/nutrients`, {
        method: "POST",
        body: { nutrients },
      });
    },
    onSuccess: () => {
      setError(null);
      onSaved();
    },
    onError: setError,
  });

  const sorted = [...nutrientDefs].sort((a, b) => a.displayOrder - b.displayOrder);

  return (
    <Card title="Nutrients (per 100g)">
      {error !== null && <ErrorBanner error={error} />}
      <Table>
        <Thead>
          <Tr>
            <Th>Nutrient</Th>
            <Th>Unit</Th>
            <Th>Value / 100g</Th>
          </Tr>
        </Thead>
        <Tbody>
          {sorted.map((def) => (
            <Tr key={def.key}>
              <Td>{def.nameEn}</Td>
              <Td>{def.unit}</Td>
              <Td>
                <Input
                  type="number"
                  step="any"
                  className="w-32"
                  disabled={!canWrite}
                  value={values[def.key] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [def.key]: e.target.value }))}
                />
              </Td>
            </Tr>
          ))}
        </Tbody>
      </Table>
      {canWrite && (
        <Button className="mt-3" size="sm" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
          {mutation.isPending ? "Saving…" : "Save nutrients"}
        </Button>
      )}
    </Card>
  );
}

function AliasesEditor({ food, canWrite, onSaved }: { food: AdminFood; canWrite: boolean; onSaved: () => void }) {
  const [alias, setAlias] = useState("");
  const [kind, setKind] = useState<AliasKind>("iraqi_dialect");
  const [locale, setLocale] = useState("");
  const [error, setError] = useState<unknown>(null);

  const addMutation = useMutation({
    mutationFn: () =>
      apiFetch<AdminFood>(`/admin/catalog/foods/${food.id}/aliases`, {
        method: "POST",
        body: { alias, kind, locale: locale || null },
      }),
    onSuccess: () => {
      setAlias("");
      setError(null);
      onSaved();
    },
    onError: setError,
  });

  const removeMutation = useMutation({
    mutationFn: (aliasId: string) =>
      apiFetch(`/admin/catalog/foods/${food.id}/aliases/${aliasId}`, { method: "DELETE", parseAs: "none" }),
    onSuccess: onSaved,
    onError: setError,
  });

  return (
    <Card title="Aliases">
      {error !== null && <ErrorBanner error={error} />}
      <ul className="mb-3 space-y-1">
        {food.aliases.map((a) => (
          <li key={a.id} className="flex items-center justify-between text-sm">
            <span>
              {a.alias} <span className="text-slate-500 dark:text-slate-400">({a.kind}{a.locale ? `, ${a.locale}` : ""})</span>
            </span>
            {canWrite && (
              <Button variant="ghost" size="sm" onClick={() => removeMutation.mutate(a.id)}>
                Remove
              </Button>
            )}
          </li>
        ))}
        {food.aliases.length === 0 && <li className="text-sm text-slate-500 dark:text-slate-400">No aliases yet.</li>}
      </ul>
      {canWrite && (
        <div className="flex flex-wrap items-end gap-2">
          <Input className="w-48" placeholder="Alias text" value={alias} onChange={(e) => setAlias(e.target.value)} />
          <Select className="w-44" value={kind} onChange={(e) => setKind(e.target.value as AliasKind)}>
            {ALIAS_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </Select>
          <Input className="w-24" placeholder="Locale" value={locale} onChange={(e) => setLocale(e.target.value)} />
          <Button size="sm" onClick={() => addMutation.mutate()} disabled={!alias.trim() || addMutation.isPending}>
            Add
          </Button>
        </div>
      )}
    </Card>
  );
}

function BarcodesEditor({ food, canWrite, onSaved }: { food: AdminFood; canWrite: boolean; onSaved: () => void }) {
  const [code, setCode] = useState("");
  const [type, setType] = useState<BarcodeType>("ean13");
  const [error, setError] = useState<unknown>(null);

  const addMutation = useMutation({
    mutationFn: () =>
      apiFetch<AdminFood>(`/admin/catalog/foods/${food.id}/barcodes`, { method: "POST", body: { code, type } }),
    onSuccess: () => {
      setCode("");
      setError(null);
      onSaved();
    },
    onError: setError,
  });

  const deactivateMutation = useMutation({
    mutationFn: (barcodeId: string) =>
      apiFetch(`/admin/catalog/foods/${food.id}/barcodes/${barcodeId}`, { method: "DELETE", parseAs: "none" }),
    onSuccess: onSaved,
    onError: setError,
  });

  return (
    <Card title="Barcodes">
      {error !== null && <ErrorBanner error={error} />}
      <ul className="mb-3 space-y-1">
        {food.barcodes.map((b) => (
          <li key={b.id} className="flex items-center justify-between text-sm">
            <span className="font-mono">
              {b.code} <span className="text-slate-500 dark:text-slate-400">({b.type})</span>{" "}
              <Badge tone={b.isActive ? "success" : "neutral"}>{b.isActive ? "active" : "inactive"}</Badge>
            </span>
            {canWrite && b.isActive && (
              <Button variant="ghost" size="sm" onClick={() => deactivateMutation.mutate(b.id)}>
                Deactivate
              </Button>
            )}
          </li>
        ))}
        {food.barcodes.length === 0 && <li className="text-sm text-slate-500 dark:text-slate-400">No barcodes yet.</li>}
      </ul>
      {canWrite && (
        <div className="flex flex-wrap items-end gap-2">
          <Input className="w-44" placeholder="6-14 digit code" value={code} onChange={(e) => setCode(e.target.value)} />
          <Select className="w-36" value={type} onChange={(e) => setType(e.target.value as BarcodeType)}>
            {BARCODE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
          <Button size="sm" onClick={() => addMutation.mutate()} disabled={!code.trim() || addMutation.isPending}>
            Add
          </Button>
        </div>
      )}
    </Card>
  );
}

function PortionsEditor({ food, canWrite, onSaved }: { food: AdminFood; canWrite: boolean; onSaved: () => void }) {
  const [labelEn, setLabelEn] = useState("");
  const [labelAr, setLabelAr] = useState("");
  const [grams, setGrams] = useState("");
  const [source, setSource] = useState<PortionSource>("curated");
  const [error, setError] = useState<unknown>(null);

  const addMutation = useMutation({
    mutationFn: () =>
      apiFetch<AdminFood>(`/admin/catalog/foods/${food.id}/portions`, {
        method: "POST",
        body: { labelEn, labelAr, grams: Number(grams), source },
      }),
    onSuccess: () => {
      setLabelEn("");
      setLabelAr("");
      setGrams("");
      setError(null);
      onSaved();
    },
    onError: setError,
  });

  const removeMutation = useMutation({
    mutationFn: (portionId: string) =>
      apiFetch(`/admin/catalog/foods/${food.id}/portions/${portionId}`, { method: "DELETE", parseAs: "none" }),
    onSuccess: onSaved,
    onError: setError,
  });

  return (
    <Card title="Portions">
      {error !== null && <ErrorBanner error={error} />}
      <ul className="mb-3 space-y-1">
        {food.portions.map((p) => (
          <li key={p.id} className="flex items-center justify-between text-sm">
            <span>
              {p.labelEn} — {p.grams}g{" "}
              {p.isDefault && (
                <Badge tone="info" className="ml-1">
                  default
                </Badge>
              )}
            </span>
            {canWrite && (
              <Button variant="ghost" size="sm" onClick={() => removeMutation.mutate(p.id)}>
                Remove
              </Button>
            )}
          </li>
        ))}
        {food.portions.length === 0 && <li className="text-sm text-slate-500 dark:text-slate-400">No portions yet.</li>}
      </ul>
      {canWrite && (
        <div className="flex flex-wrap items-end gap-2">
          <Input className="w-36" placeholder="Label (EN)" value={labelEn} onChange={(e) => setLabelEn(e.target.value)} />
          <Input className="w-36" dir="rtl" placeholder="Label (AR)" value={labelAr} onChange={(e) => setLabelAr(e.target.value)} />
          <Input className="w-24" type="number" placeholder="Grams" value={grams} onChange={(e) => setGrams(e.target.value)} />
          <Select className="w-36" value={source} onChange={(e) => setSource(e.target.value as PortionSource)}>
            {PORTION_SOURCES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
          <Button
            size="sm"
            onClick={() => addMutation.mutate()}
            disabled={!labelEn.trim() || !labelAr.trim() || !grams || addMutation.isPending}
          >
            Add
          </Button>
        </div>
      )}
    </Card>
  );
}
