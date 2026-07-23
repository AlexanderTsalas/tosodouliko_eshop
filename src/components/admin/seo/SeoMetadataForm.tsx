"use client";

import { useState, useTransition } from "react";
import { upsertSeoMetadata } from "@/actions/seo/upsertSeoMetadata";
import { deleteSeoMetadata } from "@/actions/seo/deleteSeoMetadata";
import type { SeoMetadata } from "@/types/dynamic-seo";

interface Props {
  resourceType: string;
  resourceId: string;
  initial?: SeoMetadata | null;
}

export default function SeoMetadataForm({ resourceType, resourceId, initial }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const r = await upsertSeoMetadata({
        resourceType,
        resourceId,
        title: String(formData.get("title") ?? "") || null,
        description: String(formData.get("description") ?? "") || null,
        ogImageUrl: String(formData.get("ogImageUrl") ?? "") || null,
        robots: String(formData.get("robots") ?? "") || null,
        canonicalUrl: String(formData.get("canonicalUrl") ?? "") || null,
        noIndex: formData.get("noIndex") === "on",
      });
      if (!r.success) {
        setError(r.error);
        return;
      }
      setSavedAt(Date.now());
    });
  }

  function handleDelete() {
    if (!initial) return;
    if (!confirm("Διαγραφή SEO metadata;")) return;
    setError(null);
    startTransition(async () => {
      const r = await deleteSeoMetadata({ id: initial.id });
      if (!r.success) setError(r.error);
    });
  }

  return (
    <form action={handleSubmit} className="grid grid-cols-2 gap-3 max-w-2xl">
      <label className="flex flex-col gap-1 col-span-2">
        <span className="text-sm font-medium">Τίτλος (meta title)</span>
        <input name="title" defaultValue={initial?.title ?? ""} maxLength={200} className="border rounded px-3 py-2" />
      </label>

      <label className="flex flex-col gap-1 col-span-2">
        <span className="text-sm font-medium">Περιγραφή (meta description)</span>
        <textarea
          name="description"
          rows={3}
          defaultValue={initial?.description ?? ""}
          maxLength={500}
          className="border rounded px-3 py-2"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">OG image URL</span>
        <input
          type="url"
          name="ogImageUrl"
          defaultValue={initial?.og_image_url ?? ""}
          className="border rounded px-3 py-2"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Canonical URL</span>
        <input
          type="url"
          name="canonicalUrl"
          defaultValue={initial?.canonical_url ?? ""}
          className="border rounded px-3 py-2"
        />
      </label>

      <label className="flex flex-col gap-1 col-span-2">
        <span className="text-sm font-medium">Robots</span>
        <input
          name="robots"
          defaultValue={initial?.robots ?? "index,follow"}
          className="border rounded px-3 py-2"
        />
      </label>

      <label className="flex items-center gap-2 col-span-2">
        <input type="checkbox" name="noIndex" defaultChecked={initial?.no_index ?? false} />
        <span className="text-sm">noindex (αποκλεισμός από αναζήτηση)</span>
      </label>

      {error && <p role="alert" className="col-span-2 text-sm text-destructive">{error}</p>}

      <div className="col-span-2 flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="rounded bg-primary text-primary-foreground px-4 py-2 disabled:opacity-50"
        >
          {isPending ? "Αποθήκευση..." : "Αποθήκευση"}
        </button>
        {initial && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={isPending}
            className="text-sm text-destructive underline"
          >
            Διαγραφή
          </button>
        )}
        {savedAt && <span className="text-xs text-muted-foreground">Αποθηκεύτηκε</span>}
      </div>
    </form>
  );
}
