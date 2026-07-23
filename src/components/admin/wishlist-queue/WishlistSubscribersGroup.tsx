import Link from "next/link";

export interface SubscriberRow {
  /** wishlist_items.id */
  id: string;
  customer_id: string | null;
  customer_email: string | null;
  customer_name: string | null;
  quantity: number;
  source: string;
  created_at: string;
}

export interface SubscriberVariantInfo {
  variant_id: string;
  product_id: string;
  product_name: string;
  product_slug: string;
  variant_label: string | null;
  available_now: number;
}

interface Props {
  variantInfo: SubscriberVariantInfo;
  rows: SubscriberRow[];
}

const SOURCE_LABEL: Record<string, string> = {
  product_page: "Σελίδα προϊόντος",
  contention_modal: "Modal διαμάχης",
  sold_out_page: "Σελίδα εξαντλημένου",
};

/**
 * Renders one variant's subscriber list: every wishlist_items row with
 * notify_on_restock=true, FIFO by created_at. No actions — this is a
 * read-only view of "who's queued". Actual notification dispatch happens
 * when inventory returns (Phase 7 admin actions or automated mode).
 */
export default function WishlistSubscribersGroup({ variantInfo, rows }: Props) {
  return (
    <section className="rounded border">
      <header className="flex items-start justify-between gap-4 p-4 border-b bg-muted/10">
        <div>
          <Link
            href={`/products/${variantInfo.product_slug}`}
            className="font-medium hover:underline"
          >
            {variantInfo.product_name}
          </Link>
          {variantInfo.variant_label && (
            <p className="text-sm text-muted-foreground">
              {variantInfo.variant_label}
            </p>
          )}
          <p className="text-sm mt-1">
            {rows.length} συνδρομητές · {variantInfo.available_now} διαθέσιμα τώρα
          </p>
        </div>
      </header>

      <ul className="divide-y">
        {rows.map((row, idx) => (
          <li
            key={row.id}
            className="p-4 flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between"
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm">
                <span className="font-mono text-xs text-muted-foreground mr-2">
                  #{idx + 1}
                </span>
                <span className="font-medium">
                  {row.customer_name ?? row.customer_email ?? "(χωρίς όνομα)"}
                </span>
              </p>
              {row.customer_email && row.customer_name && (
                <p className="text-xs text-muted-foreground">
                  {row.customer_email}
                </p>
              )}
              {!row.customer_email && (
                <p className="text-xs text-destructive">
                  Χωρίς email — δεν θα φτάσει η ειδοποίηση
                </p>
              )}
              <p className="text-xs text-muted-foreground mt-1">
                Ζητούνται {row.quantity} ·{" "}
                {SOURCE_LABEL[row.source] ?? row.source} ·{" "}
                Εγγραφή{" "}
                {new Date(row.created_at).toLocaleString("el-GR", {
                  dateStyle: "short",
                  timeStyle: "short",
                })}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
