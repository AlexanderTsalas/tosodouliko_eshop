"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createCategory } from "@/actions/categories/createCategory";
import { updateCategory } from "@/actions/categories/updateCategory";
import AutoRuleBuilder from "@/components/admin/categories/AutoRuleBuilder";
import type {
  Category,
  CategoryMode,
  AutoCategoryRules,
} from "@/types/category-navigation";
import type { Attribute, AttributeValue } from "@/types/attribute-facets";
import type { VatRate } from "@/types/vat-rates";

interface Props {
  category?: Category;
  parents: Category[];
  attributes: Attribute[];
  attributeValues: AttributeValue[];
  vatRates: VatRate[];
  mode: "create" | "edit";
}

export default function CategoryForm({
  category,
  parents,
  attributes,
  attributeValues,
  vatRates,
  mode,
}: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [categoryMode, setCategoryMode] = useState<CategoryMode>(
    category?.mode ?? "manual"
  );
  const [autoRules, setAutoRules] = useState<AutoCategoryRules>(
    category?.auto_rules ?? { attribute_filters: {} }
  );

  function handleSubmit(formData: FormData) {
    setError(null);
    const base = {
      name: String(formData.get("name") ?? ""),
      slug: String(formData.get("slug") ?? "") || undefined,
      parentId: (String(formData.get("parentId") ?? "") || null) as string | null,
      description: String(formData.get("description") ?? "") || undefined,
      imageUrl: String(formData.get("imageUrl") ?? "") || undefined,
      displayOrder: formData.get("displayOrder") ? Number(formData.get("displayOrder")) : 0,
      active: formData.get("active") === "on",
      mode: categoryMode,
      autoRules: categoryMode === "auto" ? autoRules : null,
      vatRateId: (String(formData.get("vatRateId") ?? "") || null) as string | null,
    };

    startTransition(async () => {
      if (mode === "create") {
        const r = await createCategory(base);
        if (!r.success) {
          setError(r.error);
          return;
        }
        router.push("/admin/categories");
      } else if (category) {
        const r = await updateCategory({ id: category.id, ...base });
        if (!r.success) {
          setError(r.error);
          return;
        }
        router.push("/admin/categories");
      }
    });
  }

  return (
    <form action={handleSubmit} className="grid grid-cols-2 gap-4 max-w-2xl">
      <label className="flex flex-col gap-1 col-span-2">
        <span className="text-sm font-medium">Όνομα *</span>
        <input
          name="name"
          required
          defaultValue={category?.name}
          className="border rounded px-3 py-2"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Slug</span>
        <input
          name="slug"
          defaultValue={category?.slug}
          placeholder="auto-generated"
          className="border rounded px-3 py-2"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Γονική κατηγορία</span>
        <select
          name="parentId"
          defaultValue={category?.parent_id ?? ""}
          className="border rounded px-3 py-2"
        >
          <option value="">— καμία —</option>
          {parents
            .filter((p) => p.id !== category?.id)
            .map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 col-span-2">
        <span className="text-sm font-medium">Περιγραφή</span>
        <textarea
          name="description"
          defaultValue={category?.description ?? ""}
          rows={3}
          className="border rounded px-3 py-2"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Image URL</span>
        <input
          name="imageUrl"
          type="url"
          defaultValue={category?.image_url ?? ""}
          className="border rounded px-3 py-2"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Σειρά εμφάνισης</span>
        <input
          type="number"
          name="displayOrder"
          defaultValue={category?.display_order ?? 0}
          className="border rounded px-3 py-2"
        />
      </label>

      <label className="flex flex-col gap-1 col-span-2">
        <span className="text-sm font-medium">Κατηγορία ΦΠΑ</span>
        <select
          name="vatRateId"
          defaultValue={category?.vat_rate_id ?? ""}
          className="border rounded px-3 py-2"
        >
          <option value="">— προεπιλογή συστήματος —</option>
          {vatRates.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name} ({(r.rate * 100).toFixed(2)}%)
            </option>
          ))}
        </select>
        <span className="text-xs text-muted-foreground">
          Κληρονομείται από όλα τα προϊόντα της κατηγορίας, εκτός αν το προϊόν έχει δική του παράκαμψη.
        </span>
      </label>

      <label className="flex items-center gap-2 col-span-2">
        <input type="checkbox" name="active" defaultChecked={category?.active ?? true} />
        <span className="text-sm">Ενεργή</span>
      </label>

      <fieldset className="col-span-2 border rounded p-4 space-y-3">
        <legend className="text-sm font-medium px-1">Τύπος κατηγορίας</legend>
        <div className="flex gap-4">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="mode"
              value="manual"
              checked={categoryMode === "manual"}
              onChange={() => setCategoryMode("manual")}
            />
            <span className="text-sm">Χειροκίνητη (επιλέγετε προϊόντα ανά προϊόν)</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="mode"
              value="auto"
              checked={categoryMode === "auto"}
              onChange={() => setCategoryMode("auto")}
            />
            <span className="text-sm">Αυτόματη (βάσει χαρακτηριστικών variant)</span>
          </label>
        </div>
        {categoryMode === "auto" && (
          <AutoRuleBuilder
            attributes={attributes}
            values={attributeValues}
            rules={autoRules}
            onChange={setAutoRules}
          />
        )}
      </fieldset>

      {error && <p role="alert" className="col-span-2 text-sm text-destructive">{error}</p>}

      <button
        type="submit"
        disabled={isPending}
        className="col-span-2 rounded bg-primary text-primary-foreground py-2 disabled:opacity-50"
      >
        {isPending
          ? "Αποθήκευση..."
          : mode === "create"
          ? "Δημιουργία κατηγορίας"
          : "Αποθήκευση αλλαγών"}
      </button>
    </form>
  );
}
