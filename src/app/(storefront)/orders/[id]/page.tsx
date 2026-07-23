import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency } from "@/lib/multi-currency";
import { buildTrackingUrl } from "@/lib/courier/buildTrackingUrl";
import { loadOrderCustomFields } from "@/lib/custom-fields/loadOrderCustomFields";
import PageHeader from "@/components/layout/PageHeader";
import type { Order, OrderItem } from "@/types/order-history";
import type { Translations } from "@/types/custom-fields";

export const dynamic = "force-dynamic";

export default async function OrderDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const supabase = await createClient();

  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) notFound();

  const { data: order } = await supabase
    .from("orders")
    .select("*, customers!inner(auth_user_id)")
    .eq("id", params.id)
    .maybeSingle();

  type OrderWithCustomer = Order & {
    carrier_slug: string | null;
    customers: { auth_user_id: string | null } | { auth_user_id: string | null }[] | null;
  };
  if (!order) notFound();
  const orderRow = order as OrderWithCustomer;
  const cust = Array.isArray(orderRow.customers)
    ? orderRow.customers[0]
    : orderRow.customers;
  if (cust?.auth_user_id !== authData.user.id) notFound();
  const o = orderRow;

  // Fetch order items, carrier row, and the frozen custom-
  // field rows in parallel.
  const orderCarrierSlug = o.carrier_slug ?? o.carrier;
  const [itemsRes, carrierRes, customFieldsByOrderItem] = await Promise.all([
    supabase.from("order_items").select("*").eq("order_id", params.id),
    orderCarrierSlug
      ? supabase
          .from("delivery_carriers")
          .select("display_name, tracking_url_template")
          .eq("slug", orderCarrierSlug)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    loadOrderCustomFields(params.id),
  ]);
  const items = itemsRes.data;
  const carrierRow = carrierRes.data as {
    display_name: string;
    tracking_url_template: string | null;
  } | null;

  const trackingUrl = buildTrackingUrl(
    {
      tracking_number: o.tracking_number,
      tracking_url_override: o.tracking_url_override,
    },
    carrierRow ? { tracking_url_template: carrierRow.tracking_url_template } : null
  );

  // Phase 8j: contact-merchant escape hatch — opens the customer's
  // email client with a pre-filled subject + body referencing this
  // order. Recipient comes from NEXT_PUBLIC_SUPPORT_EMAIL when set;
  // otherwise the customer fills in the To: themselves.
  const supportEmail = process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "";
  const contactSubject = encodeURIComponent(
    `Παραγγελία ${o.order_number} — Ερώτηση`
  );
  const contactBody = encodeURIComponent(
    `Καλησπέρα,\n\nΑναφέρομαι στην παραγγελία ${o.order_number} με ημερομηνία ${new Date(
      o.created_at
    ).toLocaleDateString("el-GR")}.\n\n[Γράψτε εδώ το ερώτημά σας]\n\nΕυχαριστώ,\n`
  );
  const contactHref = `mailto:${supportEmail}?subject=${contactSubject}&body=${contactBody}`;

  const hasAnyCustomFields = Object.values(customFieldsByOrderItem).some(
    (list) => list.length > 0
  );

  return (
    <main className="container mx-auto px-4 py-8 max-w-3xl">
      <PageHeader
        title={`Παραγγελία ${o.order_number}`}
        description={`${new Date(o.created_at).toLocaleString("el-GR")} · ${o.fulfillment_status} · πληρωμή: ${o.payment_status}`}
        breadcrumb={[{ label: "Αρχική", href: "/" }, { label: "Παραγγελίες", href: "/orders" }, { label: o.order_number }]}
      />

      {trackingUrl && (
        <div className="mt-4">
          <a
            href={trackingUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded border border-primary text-primary px-3 py-1.5 text-sm hover:bg-primary hover:text-primary-foreground transition-colors"
          >
            Παρακολούθηση{carrierRow ? ` στο ${carrierRow.display_name}` : ""} →
          </a>
        </div>
      )}

      <h2 className="text-lg font-medium mt-6">Προϊόντα</h2>
      <ul className="divide-y mt-2">
        {((items ?? []) as OrderItem[]).map((it) => {
          const customFields = customFieldsByOrderItem[it.id] ?? [];
          const modifierPerUnit = Number(
            (it as unknown as { modifier_total: number | string | null })
              .modifier_total
          ) || 0;
          return (
            <li key={it.id} className="py-3 space-y-1.5">
              <div className="flex justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">{it.product_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {it.quantity} ×{" "}
                    {formatCurrency(Number(it.unit_price), o.currency)}
                    {modifierPerUnit > 0 && (
                      <span className="text-emerald-700">
                        {" "}
                        + {formatCurrency(modifierPerUnit, o.currency)}
                      </span>
                    )}
                  </p>
                </div>
                <span className="tabular-nums">
                  {formatCurrency(Number(it.total), o.currency)}
                </span>
              </div>
              {customFields.length > 0 && (
                <div className="rounded-sm bg-warm-sand/40 border border-stone-taupe/20 px-3 py-2 text-xs space-y-0.5">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                    Προσαρμογές
                  </p>
                  <ul className="space-y-0.5">
                    {customFields.map((cf) => (
                      <li
                        key={cf.id}
                        className="flex items-start gap-1.5"
                      >
                        <span className="font-medium">
                          {pickLabel(cf.field.label_translations) ?? cf.field.key}
                          {cf.unit_index !== null && (
                            <span className="text-muted-foreground">
                              {" "}
                              (#{cf.unit_index + 1})
                            </span>
                          )}
                          :
                        </span>
                        <span className="flex-1 break-words">
                          {formatCustomerValue(cf)}
                        </span>
                        {cf.contributed_price > 0 && (
                          <span className="shrink-0 tabular-nums text-emerald-700">
                            +
                            {formatCurrency(
                              cf.contributed_price,
                              o.currency
                            )}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <dl className="mt-6 grid grid-cols-2 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Υποσύνολο</dt>
        <dd className="text-right">{formatCurrency(Number(o.subtotal), o.currency)}</dd>
        <dt className="text-muted-foreground">Έκπτωση</dt>
        <dd className="text-right">−{formatCurrency(Number(o.discount_amount), o.currency)}</dd>
        <dt className="text-muted-foreground">Μεταφορικά</dt>
        <dd className="text-right">{formatCurrency(Number(o.shipping_amount), o.currency)}</dd>
        <dt className="text-muted-foreground">ΦΠΑ</dt>
        <dd className="text-right">{formatCurrency(Number(o.tax_amount), o.currency)}</dd>
        <dt className="font-medium">Σύνολο</dt>
        <dd className="text-right font-medium">{formatCurrency(Number(o.total), o.currency)}</dd>
      </dl>

      {/* Contact-merchant escape hatch (Phase 8j). Surfaced for every
          order, with a contextual hint when the customer has set
          custom-field values (most likely reason to write in). */}
      <section className="mt-8 pt-6 border-t border-border">
        <h2 className="text-base font-medium">
          Έχεις σχόλιο για την παραγγελία;
        </h2>
        {hasAnyCustomFields ? (
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            Οι προσαρμογές της παραγγελίας είναι πλέον παγωμένες (δεν
            επεξεργάζονται από εσένα μετά την πληρωμή). Αν χρειάζεται
            διόρθωση — π.χ. τυπογραφικό σε μήνυμα δώρου — επικοινώνησε
            μαζί μας πριν την αποστολή και θα προσπαθήσουμε να βοηθήσουμε.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground mt-1">
            Επικοινώνησε μαζί μας για ό,τι αφορά την παραγγελία σου.
          </p>
        )}
        <a
          href={contactHref}
          className="mt-3 inline-flex items-center gap-1.5 rounded-sm border border-stone-taupe/30 px-3 py-1.5 text-sm hover:border-terracotta hover:text-terracotta transition-colors"
        >
          Επικοινωνία με κατάστημα →
        </a>
      </section>
    </main>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────

function pickLabel(translations: Translations | null): string | null {
  if (!translations) return null;
  return translations.el || translations.en || null;
}

function formatCustomerValue(
  cf: Awaited<ReturnType<typeof loadOrderCustomFields>>[string][number]
): string {
  const { value } = cf;
  const dt = cf.field.data_type;
  if (dt === "boolean") {
    const match = cf.field.values.find((v) => v.value === value);
    return (
      pickLabel(match?.label_translations ?? null) ??
      (value ? "Ναι" : "Όχι")
    );
  }
  if (dt === "dropdown") {
    const match = cf.field.values.find(
      (v) => typeof v.value === "string" && v.value === value
    );
    return pickLabel(match?.label_translations ?? null) ?? String(value);
  }
  if (dt === "multi_select") {
    if (!Array.isArray(value)) return "—";
    const labels = (value as unknown[]).map((sel) => {
      const match = cf.field.values.find(
        (v) => typeof v.value === "string" && v.value === sel
      );
      return pickLabel(match?.label_translations ?? null) ?? String(sel);
    });
    return labels.join(", ");
  }
  if (dt === "number") return value === null ? "—" : String(value);
  if (dt === "text") return (value as string) || "—";
  return JSON.stringify(value);
}
