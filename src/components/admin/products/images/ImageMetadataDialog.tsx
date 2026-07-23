"use client";

import { useState, useTransition } from "react";
import { X } from "lucide-react";
import type { ProductImage } from "@/types/products";
import type {
  Attribute,
  AttributeValue,
} from "@/types/attribute-facets";

interface Props {
  image: ProductImage;
  /** Axes available for THIS product (filtered to those used by at
   *  least one variant — passed from the parent). */
  availableAxes: Array<{ slug: string; name: string }>;
  /** Possible values for each axis. */
  attributeValues: AttributeValue[];
  /** Full attribute list, for fallback lookups (attribute id ↔ slug). */
  attributes: Attribute[];
  onClose: () => void;
  /** Fired with the patch when the admin clicks Save.
   *  - altText: undefined means "no change to alt text"; null means
   *    "reset to auto-generation"; string means user override.
   *  - attributeCombo: undefined means "no change"; empty object means
   *    "general image (applies to all variants)"; populated object
   *    targets specific axis values. */
  onSubmit: (patch: {
    altText?: string | null;
    attributeCombo?: Record<string, string>;
  }) => Promise<void>;
}

/**
 * Per-image metadata editor.
 *
 * Two editable fields:
 *  - Alt text (with "Επαναφορά αυτόματης παραγωγής" reset)
 *  - Attribute combo (which axis values this image targets — empty
 *    means "general image, applies to all variants")
 *
 * Surfaces the `updateProductImage` server action through the UI for
 * the first time. Auto-generated alt text was previously stuck as
 * read-only; this dialog lets admins correct semantic mismatches
 * (e.g. "wrong combo assigned during upload") without dropping to SQL.
 */
export default function ImageMetadataDialog({
  image,
  availableAxes,
  attributeValues,
  attributes,
  onClose,
  onSubmit,
}: Props) {
  // Local form state — seeded from the image, not bound to it. The
  // admin can revert without round-tripping the server.
  const [altText, setAltText] = useState<string>(image.alt_text ?? "");
  const [altTextIsAuto, setAltTextIsAuto] = useState<boolean>(
    image.alt_text_is_auto
  );
  const [combo, setCombo] = useState<Record<string, string>>(
    image.attribute_combo ?? {}
  );
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function valuesForAxis(axisSlug: string): AttributeValue[] {
    const attr = attributes.find((a) => a.slug === axisSlug);
    if (!attr) return [];
    return attributeValues
      .filter((v) => v.attribute_id === attr.id)
      .sort((a, b) => a.value.localeCompare(b.value));
  }

  function handleAxisChange(axisSlug: string, valueId: string) {
    setCombo((prev) => {
      const next = { ...prev };
      if (valueId === "") {
        delete next[axisSlug];
      } else {
        next[axisSlug] = valueId;
      }
      return next;
    });
  }

  function handleSave() {
    setError(null);
    const patch: { altText?: string | null; attributeCombo?: Record<string, string> } =
      {};

    // Alt text patch: only include if changed from initial state.
    const initialAlt = image.alt_text ?? "";
    const altChanged = altText !== initialAlt;
    const wantsReset = altTextIsAuto && !image.alt_text_is_auto;
    if (wantsReset) {
      // Server flips auto=true when altText is null. Implementation
      // note: the updateProductImage action only flips auto=false when
      // altText is set; to re-enable auto, we send altText=null.
      patch.altText = null;
    } else if (altChanged) {
      patch.altText = altText;
    }

    // Combo patch: only include if changed.
    const initialCombo = image.attribute_combo ?? {};
    const initialKeys = Object.keys(initialCombo).sort();
    const newKeys = Object.keys(combo).sort();
    const comboChanged =
      initialKeys.length !== newKeys.length ||
      initialKeys.some((k, i) => k !== newKeys[i]) ||
      initialKeys.some((k) => initialCombo[k] !== combo[k]);
    if (comboChanged) {
      patch.attributeCombo = combo;
    }

    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }

    startTransition(async () => {
      try {
        await onSubmit(patch);
        onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Σφάλμα αποθήκευσης");
      }
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="bg-background rounded-lg shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="flex items-center justify-between px-5 py-4 border-b border-foreground/10">
          <h2 className="text-base font-semibold">Επεξεργασία εικόνας</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Κλείσιμο"
            className="text-muted-foreground hover:text-foreground p-1"
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        <div className="p-5 space-y-5">
          {/* Preview */}
          <div className="flex gap-4 items-start">
            <div className="w-24 h-24 rounded-lg overflow-hidden border border-foreground/10 bg-muted/30 shrink-0">
              {image.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={image.url}
                  alt={image.alt_text ?? ""}
                  className="w-full h-full object-cover"
                />
              ) : null}
            </div>
            <div className="text-xs text-muted-foreground space-y-1">
              <div>
                <span className="font-medium text-foreground">Κωδικός:</span>{" "}
                <code className="font-mono text-[11px]">{image.id.slice(0, 8)}…</code>
              </div>
              {image.is_cover && (
                <div>
                  <span className="inline-flex items-center gap-1 text-amber-600 font-medium">
                    ★ Είναι εξώφυλλο της ομάδας
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Alt text */}
          <section>
            <label className="block text-sm font-medium mb-1.5">
              Εναλλακτικό κείμενο (alt text)
            </label>
            <textarea
              value={altText}
              onChange={(e) => {
                setAltText(e.target.value);
                setAltTextIsAuto(false);
              }}
              rows={2}
              maxLength={500}
              className="cms-input"
              placeholder="π.χ. Παιδικό μπλουζάκι, κόκκινο, μπροστινή όψη"
              disabled={altTextIsAuto && image.alt_text_is_auto}
            />
            <div className="flex items-center justify-between mt-1.5">
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={altTextIsAuto}
                  onChange={(e) => {
                    setAltTextIsAuto(e.target.checked);
                    if (e.target.checked) {
                      // Reset visible field to the current auto value
                      // (server will regenerate on save).
                      setAltText(image.alt_text ?? "");
                    }
                  }}
                />
                Αυτόματη παραγωγή από το όνομα + παραλλαγή
              </label>
              <span className="text-xs text-muted-foreground tabular-nums">
                {altText.length}/500
              </span>
            </div>
          </section>

          {/* Attribute combo */}
          <section>
            <label className="block text-sm font-medium mb-1.5">
              Σε ποιες παραλλαγές εφαρμόζεται
            </label>
            <p className="text-xs text-muted-foreground mb-3">
              Άφησε «οποιαδήποτε» για να εφαρμόζεται σε όλες τις παραλλαγές
              αυτής της διάστασης. Άδειο σε όλες τις διαστάσεις = γενική
              εικόνα (όλες οι παραλλαγές).
            </p>
            {availableAxes.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">
                Δεν έχουν επιλεγεί διαστάσεις εικόνας για αυτό το προϊόν.
              </p>
            ) : (
              <div className="space-y-2">
                {availableAxes.map((axis) => {
                  const values = valuesForAxis(axis.slug);
                  const currentValueId = combo[axis.slug] ?? "";
                  return (
                    <div key={axis.slug} className="grid grid-cols-3 gap-2 items-center">
                      <label
                        htmlFor={`axis-${axis.slug}`}
                        className="text-sm text-foreground/80"
                      >
                        {axis.name}
                      </label>
                      <select
                        id={`axis-${axis.slug}`}
                        value={currentValueId}
                        onChange={(e) =>
                          handleAxisChange(axis.slug, e.target.value)
                        }
                        className="cms-input col-span-2"
                      >
                        <option value="">(οποιαδήποτε)</option>
                        {values.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.value}
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {error && (
            <p className="text-xs text-destructive bg-destructive/10 px-3 py-2 rounded">
              {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <footer className="flex items-center justify-end gap-2 px-5 py-3 border-t border-foreground/10 bg-muted/20">
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="btn btn-secondary btn-sm"
          >
            Ακύρωση
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isPending}
            className="btn btn-primary btn-sm"
          >
            {isPending ? "Αποθήκευση…" : "Αποθήκευση"}
          </button>
        </footer>
      </div>
    </div>
  );
}
