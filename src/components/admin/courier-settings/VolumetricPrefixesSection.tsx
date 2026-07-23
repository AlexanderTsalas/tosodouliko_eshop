"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createVolumetricPrefix,
  updateVolumetricPrefix,
  deleteVolumetricPrefix,
} from "@/actions/volumetric";
import Toggle from "@/components/admin/common/Toggle";
import { Pencil } from "@/components/admin/common/icons";
import DeleteButton from "@/components/admin/common/DeleteButton";
import type { VolumetricPrefix } from "@/types/volumetric";

interface Props {
  initial: VolumetricPrefix[];
  /**
   * Active carrier slugs that have an integration class — used to
   * scaffold the carrier_codes mapping form so admins know which keys
   * to fill in. Carriers without integrations don't appear (they
   * don't read codes anyway).
   */
  knownCarrierSlugs: string[];
}

/**
 * Admin surface for the volumetric_prefixes table. Layout:
 *
 *   - Top: list of existing prefixes as cards
 *     · click "Επεξεργασία" to expand the row into the edit form
 *     · "✕" deletes (cascade-nullifies products' volumetric_prefix_id)
 *   - Bottom: "+ Νέο μέγεθος" creates a new prefix
 *
 * Each prefix carries: name, slug, dimensions/weight caps, and a
 * per-carrier code mapping. The carrier-codes form renders one input
 * per known carrier slug — admins can leave any of them blank if that
 * carrier doesn't need a size class.
 */
export default function VolumetricPrefixesSection({
  initial,
  knownCarrierSlugs,
}: Props) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creatingNew, setCreatingNew] = useState(false);

  function handleDelete(p: VolumetricPrefix) {
    if (
      !confirm(
        `Διαγραφή μεγέθους «${p.display_name}»;\n\nΌσα προϊόντα είναι αναθετημένα σε αυτό θα παραμείνουν, αλλά χωρίς αντιστοίχιση μεγέθους.`
      )
    )
      return;
    setError(null);
    const prev = items;
    setItems((cur) => cur.filter((x) => x.id !== p.id));
    startTransition(async () => {
      const r = await deleteVolumetricPrefix({ id: p.id });
      if (!r.success) {
        setError(r.error);
        setItems(prev);
      } else {
        router.refresh();
      }
    });
  }

  function handleSave(p: VolumetricPrefix) {
    // Optimistic — replace the row in local state. Server response
    // will replace it again via router.refresh() with canonical data.
    setItems((cur) => cur.map((x) => (x.id === p.id ? p : x)));
    setEditingId(null);
    router.refresh();
  }

  function handleCreated(p: VolumetricPrefix) {
    setItems((cur) => [...cur, p].sort((a, b) => a.display_order - b.display_order));
    setCreatingNew(false);
    router.refresh();
  }

  return (
    <section className="space-y-4">
      <header className="flex items-baseline justify-between">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Μεγέθη πακέτου
          </h2>
          <p className="text-xs text-muted-foreground mt-1 max-w-3xl">
            Ονομασμένες κατηγορίες μεγέθους πακέτου που χρησιμοποιούν τα locker
            couriers (BoxNow, Speedex APM κ.ά.) όταν χρεώνουν βάσει κλάσης
            μεγέθους. Κάθε προϊόν αναθέτεται σε ένα μέγεθος και ο κάθε courier
            διαβάζει τον δικό του κωδικό από τη στήλη «Κωδικοί ανά courier».
          </p>
        </div>
      </header>

      {error && (
        <p
          role="alert"
          className="text-sm text-destructive bg-destructive/5 border border-destructive/30 rounded-md px-3 py-2"
        >
          {error}
        </p>
      )}

      {items.length === 0 && !creatingNew && (
        <div className="cms-empty">
          Δεν υπάρχουν αποθηκευμένα μεγέθη. Δημιουργήστε το πρώτο παρακάτω.
        </div>
      )}

      {items.length > 0 && (
        <div className="space-y-3">
          {items.map((p) =>
            editingId === p.id ? (
              <PrefixForm
                key={p.id}
                initial={p}
                knownCarrierSlugs={knownCarrierSlugs}
                onCancel={() => setEditingId(null)}
                onSaved={handleSave}
              />
            ) : (
              <PrefixCard
                key={p.id}
                prefix={p}
                isPending={isPending}
                onEdit={() => setEditingId(p.id)}
                onDelete={() => handleDelete(p)}
              />
            )
          )}
        </div>
      )}

      {creatingNew ? (
        <PrefixForm
          initial={null}
          knownCarrierSlugs={knownCarrierSlugs}
          onCancel={() => setCreatingNew(false)}
          onSaved={handleCreated}
        />
      ) : (
        <button
          type="button"
          onClick={() => setCreatingNew(true)}
          className="btn btn-secondary btn-md"
        >
          <span className="text-base leading-none">+</span> Νέο μέγεθος
        </button>
      )}
    </section>
  );
}

/**
 * Read-only card displaying one prefix's summary. Dimensions are
 * displayed in centimetres for human readability (the DB stores
 * millimeters); weight is shown in grams if < 1kg, else kilograms.
 */
function PrefixCard({
  prefix,
  isPending,
  onEdit,
  onDelete,
}: {
  prefix: VolumetricPrefix;
  isPending: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const dims = formatDimensions(prefix);
  const carrierEntries = Object.entries(prefix.carrier_codes ?? {}).filter(
    ([, v]) => v !== null && v !== ""
  );
  return (
    <article
      className={`cms-card flex flex-wrap items-start justify-between gap-4 ${
        !prefix.active ? "opacity-60" : ""
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="font-semibold tracking-tight">{prefix.display_name}</h3>
          <code className="text-xs font-mono text-muted-foreground">
            {prefix.slug}
          </code>
          {!prefix.active && (
            <span className="cms-badge cms-badge-muted">ανενεργό</span>
          )}
        </div>
        {prefix.description && (
          <p className="text-sm text-muted-foreground mt-1.5">
            {prefix.description}
          </p>
        )}
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs mt-3">
          <dt className="text-muted-foreground">Διαστάσεις</dt>
          <dd className="font-mono">{dims || "—"}</dd>
          <dt className="text-muted-foreground">Μέγιστο βάρος</dt>
          <dd className="font-mono">{formatWeight(prefix.max_weight_g)}</dd>
          <dt className="text-muted-foreground">Κωδικοί ανά courier</dt>
          <dd className="flex flex-wrap gap-1.5">
            {carrierEntries.length === 0 ? (
              <span className="text-muted-foreground italic">
                Δεν έχουν οριστεί
              </span>
            ) : (
              carrierEntries.map(([slug, code]) => (
                <span
                  key={slug}
                  className="cms-badge cms-badge-muted font-mono"
                >
                  {slug} = {String(code)}
                </span>
              ))
            )}
          </dd>
        </dl>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          onClick={onEdit}
          disabled={isPending}
          className="btn btn-secondary btn-sm"
        >
          <Pencil className="w-3.5 h-3.5" />
          Επεξεργασία
        </button>
        <DeleteButton
          onClick={onDelete}
          ariaLabel={`Διαγραφή ${prefix.display_name}`}
          title={`Διαγραφή ${prefix.display_name}`}
          disabled={isPending}
        />
      </div>
    </article>
  );
}

/**
 * Create/edit form. When `initial` is null, calls
 * createVolumetricPrefix; otherwise updateVolumetricPrefix. Same form
 * shape either way — the difference is the slug field is locked on
 * edit (slug is the stable identifier referenced by URLs / migrations
 * and shouldn't drift after creation).
 */
function PrefixForm({
  initial,
  knownCarrierSlugs,
  onCancel,
  onSaved,
}: {
  initial: VolumetricPrefix | null;
  knownCarrierSlugs: string[];
  onCancel: () => void;
  onSaved: (p: VolumetricPrefix) => void;
}) {
  const isEdit = initial !== null;
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [displayName, setDisplayName] = useState(initial?.display_name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [maxLengthMm, setMaxLengthMm] = useState(
    initial?.max_length_mm?.toString() ?? ""
  );
  const [maxWidthMm, setMaxWidthMm] = useState(
    initial?.max_width_mm?.toString() ?? ""
  );
  const [maxHeightMm, setMaxHeightMm] = useState(
    initial?.max_height_mm?.toString() ?? ""
  );
  const [maxWeightG, setMaxWeightG] = useState(
    initial?.max_weight_g?.toString() ?? ""
  );
  const [carrierCodes, setCarrierCodes] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {};
    // Pre-populate keys for every known carrier so admins see the full
    // list and only fill what they need.
    for (const s of knownCarrierSlugs) seed[s] = "";
    // Overlay existing values.
    for (const [k, v] of Object.entries(initial?.carrier_codes ?? {})) {
      seed[k] = String(v);
    }
    return seed;
  });
  const [displayOrder, setDisplayOrder] = useState(
    initial?.display_order?.toString() ?? "100"
  );
  const [active, setActive] = useState(initial?.active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function parseOptionalInt(v: string): number | null {
    const t = v.trim();
    if (!t) return null;
    const n = parseInt(t, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  function handleSubmit() {
    setError(null);

    // Build carrier_codes: keep only keys with non-empty values. Try to
    // coerce numeric strings ("1", "2") to numbers since BoxNow expects
    // an integer; non-numeric values stay as strings (ACS "STD" etc).
    const codes: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(carrierCodes)) {
      const trimmed = v.trim();
      if (!trimmed) continue;
      const n = Number(trimmed);
      codes[k] = Number.isFinite(n) && /^\d+$/.test(trimmed) ? n : trimmed;
    }

    startTransition(async () => {
      const r = isEdit
        ? await updateVolumetricPrefix({
            id: initial!.id,
            displayName,
            description: description.trim() || null,
            maxLengthMm: parseOptionalInt(maxLengthMm),
            maxWidthMm: parseOptionalInt(maxWidthMm),
            maxHeightMm: parseOptionalInt(maxHeightMm),
            maxWeightG: parseOptionalInt(maxWeightG),
            carrierCodes: codes,
            displayOrder: parseInt(displayOrder, 10) || 100,
            active,
          })
        : await createVolumetricPrefix({
            slug: slug.trim().toLowerCase(),
            displayName,
            description: description.trim() || null,
            maxLengthMm: parseOptionalInt(maxLengthMm),
            maxWidthMm: parseOptionalInt(maxWidthMm),
            maxHeightMm: parseOptionalInt(maxHeightMm),
            maxWeightG: parseOptionalInt(maxWeightG),
            carrierCodes: codes,
            displayOrder: parseInt(displayOrder, 10) || 100,
            active,
          });
      if (!r.success) {
        setError(r.error);
        return;
      }
      onSaved(r.data);
    });
  }

  return (
    <article className="cms-card border-foreground space-y-4">
      <header>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {isEdit ? `Επεξεργασία: ${initial!.display_name}` : "Νέο μέγεθος"}
        </h3>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="block">
          <span className="block text-sm font-medium mb-1.5">Όνομα *</span>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="π.χ. Small"
            className="cms-input"
          />
        </label>
        <label className="block">
          <span className="block text-sm font-medium mb-1.5">
            Slug {isEdit && (
              <span className="text-xs text-muted-foreground font-normal ml-1">
                (δεν αλλάζει)
              </span>
            )}
          </span>
          <input
            value={slug}
            onChange={(e) =>
              setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "-"))
            }
            disabled={isEdit}
            placeholder="small"
            className="cms-input font-mono"
          />
        </label>
      </div>

      <label className="block">
        <span className="block text-sm font-medium mb-1.5">
          Περιγραφή{" "}
          <span className="text-xs text-muted-foreground font-normal">
            (προαιρετικό)
          </span>
        </span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className="cms-input"
          style={{ height: "auto", minHeight: "4.5rem" }}
        />
      </label>

      <div>
        <span className="block text-sm font-medium mb-1.5">
          Μέγιστες διαστάσεις (mm){" "}
          <span className="text-xs text-muted-foreground font-normal">
            Μ × Π × Υ
          </span>
        </span>
        <div className="cms-input flex items-center gap-2 px-2.5 py-0 max-w-md focus-within:border-foreground focus-within:ring-2 focus-within:ring-foreground/15">
          <input
            type="number"
            min={1}
            value={maxLengthMm}
            onChange={(e) => setMaxLengthMm(e.target.value)}
            placeholder="μήκος"
            className="w-full text-center font-mono bg-transparent border-0 outline-none focus:ring-0 px-0 py-2"
          />
          <span className="text-muted-foreground select-none">×</span>
          <input
            type="number"
            min={1}
            value={maxWidthMm}
            onChange={(e) => setMaxWidthMm(e.target.value)}
            placeholder="πλάτος"
            className="w-full text-center font-mono bg-transparent border-0 outline-none focus:ring-0 px-0 py-2"
          />
          <span className="text-muted-foreground select-none">×</span>
          <input
            type="number"
            min={1}
            value={maxHeightMm}
            onChange={(e) => setMaxHeightMm(e.target.value)}
            placeholder="ύψος"
            className="w-full text-center font-mono bg-transparent border-0 outline-none focus:ring-0 px-0 py-2"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="block">
          <span className="block text-sm font-medium mb-1.5">
            Μέγιστο βάρος (g)
          </span>
          <input
            type="number"
            min={1}
            value={maxWeightG}
            onChange={(e) => setMaxWeightG(e.target.value)}
            placeholder="—"
            className="cms-input font-mono"
          />
        </label>
        <label className="block">
          <span className="block text-sm font-medium mb-1.5">
            Σειρά εμφάνισης
          </span>
          <input
            type="number"
            min={0}
            value={displayOrder}
            onChange={(e) => setDisplayOrder(e.target.value)}
            className="cms-input font-mono"
          />
        </label>
      </div>

      <fieldset className="rounded-md border border-foreground/15 bg-muted/20 p-4 space-y-3">
        <legend className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground px-2 -ml-2">
          Κωδικοί ανά courier
        </legend>
        <p className="text-xs text-muted-foreground">
          Ο κωδικός που στέλνεται στο API κάθε courier για να αναγνωρίσει αυτό
          το μέγεθος. Αφήστε κενό όσους courier δεν χρειάζονται κωδικό
          μεγέθους (π.χ. ταχυδρομικές υπηρεσίες που χρεώνουν μόνο βάσει
          βάρους).
        </p>
        {knownCarrierSlugs.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">
            Δεν υπάρχουν διαμορφωμένοι couriers ακόμη. Προσθέστε ένα API
            integration από την καρτέλα «API integrations» πρώτα.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {knownCarrierSlugs.map((s) => (
              <label key={s} className="block">
                <span className="block text-sm font-medium mb-1.5 capitalize">
                  {s}
                </span>
                <input
                  value={carrierCodes[s] ?? ""}
                  onChange={(e) =>
                    setCarrierCodes((cur) => ({ ...cur, [s]: e.target.value }))
                  }
                  placeholder="π.χ. 1 ή STD"
                  className="cms-input font-mono"
                />
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <label className="flex items-start justify-between gap-3 rounded-md border border-foreground/15 bg-muted/20 px-3 py-2.5 cursor-pointer hover:bg-muted/30 transition-colors">
        <div>
          <p className="text-sm font-medium">Ενεργό</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Ανενεργά μεγέθη δεν εμφανίζονται στον dropdown της σελίδας
            προϊόντος (υπάρχοντες αναθέσεις διατηρούνται).
          </p>
        </div>
        <Toggle checked={active} onChange={setActive} size="sm" />
      </label>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-foreground/10">
        <button
          type="button"
          onClick={onCancel}
          disabled={isPending}
          className="btn btn-secondary btn-sm"
        >
          Άκυρο
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isPending || !displayName.trim() || (!isEdit && !slug.trim())}
          className="btn btn-primary btn-md"
        >
          {isPending
            ? "Αποθήκευση..."
            : isEdit
              ? "Αποθήκευση"
              : "Δημιουργία"}
        </button>
      </div>
    </article>
  );
}

function formatDimensions(p: VolumetricPrefix): string {
  if (
    p.max_length_mm === null &&
    p.max_width_mm === null &&
    p.max_height_mm === null
  )
    return "";
  const fmt = (n: number | null) => (n === null ? "—" : `${(n / 10).toFixed(1)}cm`);
  return `${fmt(p.max_length_mm)} × ${fmt(p.max_width_mm)} × ${fmt(p.max_height_mm)}`;
}

function formatWeight(g: number | null): string {
  if (g === null) return "Χωρίς όριο";
  if (g < 1000) return `${g} g`;
  return `${(g / 1000).toFixed(g % 1000 === 0 ? 0 : 2)} kg`;
}
