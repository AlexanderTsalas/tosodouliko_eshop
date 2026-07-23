"use client";

import { useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { updateMediaAsset } from "@/actions/media-library/updateMediaAsset";
import { deleteMediaAsset } from "@/actions/media-library/deleteMediaAsset";
import { uploadMedia } from "@/actions/media-library/uploadMedia";
import type { MediaAsset } from "@/types/media-library";

export default function MediaBrowser({ initial }: { initial: MediaAsset[] }) {
  const [items, setItems] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);

    const supabase = createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      setError("Δεν είστε συνδεδεμένος");
      return;
    }
    const storageKey = `library/${authData.user.id}/${Date.now()}-${file.name}`;
    const upload = await supabase.storage.from("media").upload(storageKey, file, {
      contentType: file.type,
      upsert: false,
    });
    if (upload.error) {
      setError(upload.error.message);
      return;
    }

    startTransition(async () => {
      const r = await uploadMedia({
        filename: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        bucket: "media",
        folder: "library",
        storageKey,
      });
      if (!r.success) {
        setError(r.error);
        return;
      }
      setItems((cur) => [r.data, ...cur]);
    });
  }

  function saveAlt(asset: MediaAsset, value: string) {
    if (value === asset.alt_text) return;
    startTransition(async () => {
      const r = await updateMediaAsset({ id: asset.id, altText: value });
      if (r.success) {
        setItems((cur) => cur.map((i) => (i.id === asset.id ? { ...i, alt_text: value } : i)));
      }
    });
  }

  function remove(id: string) {
    if (!confirm("Οριστική διαγραφή αρχείου;")) return;
    const prev = items;
    setItems((cur) => cur.filter((i) => i.id !== id));
    startTransition(async () => {
      const r = await deleteMediaAsset({ id });
      if (!r.success) {
        setError(r.error);
        setItems(prev);
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <label className="text-sm">
          Μεταφόρτωση:&nbsp;
          <input type="file" onChange={handleUpload} disabled={isPending} />
        </label>
        {error && <span className="text-sm text-destructive">{error}</span>}
      </div>

      {items.length === 0 ? (
        <p className="text-muted-foreground">Δεν υπάρχουν αρχεία.</p>
      ) : (
        <ul className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {items.map((m) => {
            const isImage = m.mime_type.startsWith("image/");
            const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${m.bucket}/${m.storage_key}`;
            return (
              <li key={m.id} className="border rounded p-2 flex flex-col gap-2">
                {isImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={url} alt={m.alt_text ?? m.filename} className="aspect-square object-cover rounded" />
                ) : (
                  <div className="aspect-square bg-muted rounded flex items-center justify-center text-xs text-muted-foreground">
                    {m.mime_type}
                  </div>
                )}
                <p className="text-xs truncate" title={m.filename}>{m.filename}</p>
                <input
                  defaultValue={m.alt_text ?? ""}
                  placeholder="alt text..."
                  onBlur={(e) => saveAlt(m, e.target.value)}
                  className="border rounded px-2 py-1 text-xs"
                />
                <div className="flex justify-between items-center text-xs">
                  <span className="text-muted-foreground">
                    {(m.size_bytes / 1024).toFixed(1)} KB
                  </span>
                  <button
                    onClick={() => remove(m.id)}
                    disabled={isPending}
                    className="text-destructive underline"
                  >
                    Delete
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
