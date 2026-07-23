"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createCustomCarrier } from "@/actions/courier-settings/createCustomCarrier";
import { updateCarrier } from "@/actions/courier-settings/updateCarrier";
import { DELIVERY_METHODS, type DeliveryMethodValue } from "@/config/storefront";
import { BUILT_IN_CARRIER_MAX_DELIVERY_METHODS } from "@/config/built-in-carrier-capabilities";
import { isBuiltInCarrier } from "@/config/carrier-slugs";

type TimelinePreset = "generic" | "acs_style" | "geniki_style" | "boxnow_style";

const TIMELINE_PRESETS: { value: TimelinePreset; label: string; help: string }[] = [
  {
    value: "generic",
    label: "Γενική (4 στάδια)",
    help: "registered → in_transit → out_for_delivery → delivered. Ασφαλής default.",
  },
  {
    value: "acs_style",
    label: "ACS-style (αναλυτικό)",
    help: "Με ενδιάμεσα στάδια pickup / hub / διανομή. Κατάλληλο για παραδοσιακό courier.",
  },
  {
    value: "geniki_style",
    label: "Geniki-style",
    help: "Παρόμοιο με ACS-style. Επιλέξτε αν η μεταφορική σας δίνει κωδικούς ανά στάδιο.",
  },
  {
    value: "boxnow_style",
    label: "BoxNow-style (locker)",
    help: "label_created → in_transit → arrived_at_locker → collected. Για lockers.",
  },
];

interface InitialData {
  slug: string;
  display_name: string;
  supported_delivery_methods: DeliveryMethodValue[];
  tracking_url_template: string | null;
  timeline_preset: TimelinePreset | null;
  is_custom: boolean;
  is_active: boolean;
}

interface Props {
  /** When set, the form is in edit mode for that carrier. Omit for create. */
  initial?: InitialData;
  /** Called after a successful save so the parent section can hide the form / refresh. */
  onSaved?: () => void;
  /** Called when the user hits cancel/close. */
  onCancel?: () => void;
}

/**
 * Phase 9 — create + edit form for delivery_carriers rows. Built-in
 * carriers get a narrowed editor (display name + timeline preset disabled);
 * custom carriers get the full form including display name and timeline.
 *
 * For built-ins, the form still lets admins:
 *   - narrow supported_delivery_methods (hide a method this courier doesn't actually serve)
 *   - override tracking_url_template (point customers at a different status page)
 *
 * Slug is auto-generated server-side for new custom carriers; never shown
 * to the user (opaque `custom_<hex>`).
 */
export default function DeliveryCarrierForm({ initial, onSaved, onCancel }: Props) {
  const router = useRouter();
  const isEdit = Boolean(initial);
  const isBuiltIn = Boolean(initial && !initial.is_custom);

  const [displayName, setDisplayName] = useState(initial?.display_name ?? "");
  const [methods, setMethods] = useState<DeliveryMethodValue[]>(
    initial?.supported_delivery_methods ?? ["home_delivery"]
  );
  const [trackingTemplate, setTrackingTemplate] = useState(
    initial?.tracking_url_template ?? ""
  );
  const [timelinePreset, setTimelinePreset] = useState<TimelinePreset>(
    initial?.timeline_preset ?? "generic"
  );

  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  /** Live preview of the tracking URL with a sample voucher. */
  const trackingPreview = useMemo(() => {
    const tpl = trackingTemplate.trim();
    if (!tpl) return null;
    return tpl.replace(/\{voucher\}/gi, "EXAMPLE123456");
  }, [trackingTemplate]);

  /**
   * Delivery-method checkboxes the user can pick from. For built-ins this
   * is the physical-capability ceiling (BoxNow → locker only, Speedex →
   * home + branch, etc.). For custom carriers all four methods are
   * available — the admin defines their own capabilities.
   *
   * Source-of-truth lives in src/config/built-in-carrier-capabilities.ts
   * and is mirrored by a DB trigger for fail-closed defence at write time.
   */
  const availableMethods = useMemo(() => {
    if (isBuiltIn && initial && isBuiltInCarrier(initial.slug)) {
      const ceiling = new Set<DeliveryMethodValue>(
        BUILT_IN_CARRIER_MAX_DELIVERY_METHODS[initial.slug]
      );
      return DELIVERY_METHODS.filter((m) => ceiling.has(m.value));
    }
    return [...DELIVERY_METHODS];
  }, [isBuiltIn, initial]);

  function toggleMethod(m: DeliveryMethodValue) {
    setMethods((prev) =>
      prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (methods.length === 0) {
      setError("Επιλέξτε τουλάχιστον έναν τρόπο παράδοσης.");
      return;
    }
    if (!isBuiltIn && !displayName.trim()) {
      setError("Συμπληρώστε το όνομα μεταφορικής.");
      return;
    }

    startTransition(async () => {
      const res = isEdit
        ? await updateCarrier({
            slug: initial!.slug,
            // Only send display_name / timeline_preset for custom carriers
            // (server rejects changes on built-ins, but we also avoid
            // bouncing on no-op equality by gating client-side).
            display_name: isBuiltIn ? undefined : displayName.trim(),
            supported_delivery_methods: methods,
            tracking_url_template: trackingTemplate.trim() || null,
            timeline_preset: isBuiltIn ? undefined : timelinePreset,
          })
        : await createCustomCarrier({
            display_name: displayName.trim(),
            supported_delivery_methods: methods,
            tracking_url_template: trackingTemplate.trim() || null,
            timeline_preset: timelinePreset,
          });

      if (!res.success) {
        setError(res.error);
        return;
      }
      onSaved?.();
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium mb-1">
          Όνομα μεταφορικής
        </label>
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          disabled={isBuiltIn || isPending}
          maxLength={120}
          required={!isBuiltIn}
          className="w-full rounded border px-2 py-1 text-sm disabled:bg-muted disabled:text-muted-foreground"
        />
        {isBuiltIn && (
          <p className="text-xs text-muted-foreground mt-1">
            Το όνομα built-in μεταφορικής δεν επεξεργάζεται.
          </p>
        )}
      </div>

      <fieldset>
        <legend className="text-sm font-medium mb-1">Τρόποι παράδοσης</legend>
        <p className="text-xs text-muted-foreground mb-2">
          {isBuiltIn
            ? "Εμφανίζονται μόνο οι τρόποι που υποστηρίζει φυσικά αυτή η μεταφορική. Μπορείτε να τους περιορίσετε, όχι να τους επεκτείνετε."
            : "Επιλέξτε ποιους τρόπους υποστηρίζει η μεταφορική. Στο checkout θα εμφανίζονται μόνο οι συμβατοί συνδυασμοί."}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {availableMethods.map((m) => (
            <label
              key={m.value}
              className="flex items-start gap-2 text-sm border rounded px-2 py-1.5"
            >
              <input
                type="checkbox"
                checked={methods.includes(m.value)}
                onChange={() => toggleMethod(m.value)}
                disabled={isPending}
                className="mt-0.5"
              />
              <span>{m.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label className="block text-sm font-medium mb-1">
          Τύπος timeline καταστάσεων
        </label>
        <select
          value={timelinePreset}
          onChange={(e) => setTimelinePreset(e.target.value as TimelinePreset)}
          disabled={isBuiltIn || isPending}
          className="w-full rounded border px-2 py-1 text-sm disabled:bg-muted disabled:text-muted-foreground"
        >
          {TIMELINE_PRESETS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground mt-1">
          {isBuiltIn
            ? "Οι built-in μεταφορικές χρησιμοποιούν τα δικά τους hardcoded timelines."
            : TIMELINE_PRESETS.find((p) => p.value === timelinePreset)?.help}
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">
          Tracking URL template <span className="text-muted-foreground font-normal">(προαιρετικό)</span>
        </label>
        <input
          type="text"
          value={trackingTemplate}
          onChange={(e) => setTrackingTemplate(e.target.value)}
          disabled={isPending}
          maxLength={2048}
          placeholder="https://www.example-courier.gr/track?voucher={voucher}"
          className="w-full rounded border px-2 py-1 text-sm font-mono"
        />
        <p className="text-xs text-muted-foreground mt-1">
          Το <code className="font-mono">{`{voucher}`}</code> αντικαθίσταται με τον αριθμό
          αποστολής. Αφήστε το κενό αν η μεταφορική δεν έχει δημόσιο tracking.
        </p>
        {trackingPreview && (
          <p className="text-xs mt-1">
            Προεπισκόπηση: <span className="font-mono">{trackingPreview}</span>
          </p>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex items-center gap-2 pt-2 border-t">
        <button
          type="submit"
          disabled={isPending}
          className="rounded bg-primary text-primary-foreground px-3 py-1.5 text-sm disabled:opacity-50"
        >
          {isPending
            ? "Αποθήκευση..."
            : isEdit
              ? "Αποθήκευση αλλαγών"
              : "Δημιουργία μεταφορικής"}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={isPending}
            className="btn btn-secondary btn-md"
          >
            Άκυρο
          </button>
        )}
      </div>
    </form>
  );
}
