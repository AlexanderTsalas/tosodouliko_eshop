"use client";

import { useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { uploadMedia } from "@/actions/media-library/uploadMedia";

/**
 * Uploads a file to Supabase Storage from the browser, then records metadata
 * via the uploadMedia server action. Returns the storage public URL on success.
 */
export default function MediaPicker({
  bucket = "media",
  folder,
  onUploaded,
}: {
  bucket?: string;
  folder?: string;
  onUploaded?: (url: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [isPending, startTransition] = useTransition();

  function handleSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setProgress(0);

    startTransition(async () => {
      const supabase = createClient();
      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user) {
        setError("Δεν είστε συνδεδεμένος");
        return;
      }

      const storageKey = `${folder ? folder + "/" : ""}${authData.user.id}/${Date.now()}-${file.name}`;

      const upload = await supabase.storage.from(bucket).upload(storageKey, file, {
        contentType: file.type,
        upsert: false,
      });
      if (upload.error) {
        setError(upload.error.message);
        return;
      }
      setProgress(100);

      const meta = await uploadMedia({
        filename: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        bucket,
        folder,
        storageKey,
      });
      if (!meta.success) {
        setError(meta.error);
        return;
      }
      const { data: pub } = supabase.storage.from(bucket).getPublicUrl(storageKey);
      onUploaded?.(pub.publicUrl);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <input
        type="file"
        onChange={handleSelect}
        disabled={isPending}
        className="text-sm"
      />
      {progress > 0 && progress < 100 && <p className="text-sm">Μεταφόρτωση... {progress}%</p>}
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
    </div>
  );
}
