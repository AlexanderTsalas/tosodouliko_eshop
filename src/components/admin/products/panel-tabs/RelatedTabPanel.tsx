"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ExternalLink,
  Sparkles,
  ArrowRight,
  ArrowDownLeft,
} from "lucide-react";
import { getProductRelatedData } from "@/actions/products/getProductRelatedData";
import CreateAssociationFromProductButton from "@/components/admin/products/CreateAssociationFromProductButton";
import TabLoading from "./TabLoading";
import type { RelatedProductsAssociationFull } from "@/types/related-products";

type Data = Awaited<ReturnType<typeof getProductRelatedData>>;

/**
 * Lazy wrapper for the related-products tab — the read-only "this
 * recommends / is recommended by" summary plus the "create from here"
 * CTA. Mirrors the old ProductRelatedTab; full editing stays in the
 * /admin/related-products workshop.
 */
export default function RelatedTabPanel({
  productId,
  productName,
}: {
  productId: string;
  productName: string;
}) {
  const [data, setData] = useState<Data | null>(null);

  useEffect(() => {
    let alive = true;
    getProductRelatedData(productId)
      .then((d) => {
        if (alive) setData(d);
      })
      .catch(() => {
        /* leave in loading state on transient failure */
      });
    return () => {
      alive = false;
    };
  }, [productId]);

  if (!data) return <TabLoading />;

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-base font-semibold flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-fuchsia-600" />
          Συσχετίσεις προτεινόμενων
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Ποιες συσχετίσεις αφορούν αυτό το προϊόν. Η πλήρης διαχείριση
          γίνεται στην ενότητα{" "}
          <Link
            href="/admin/related-products"
            className="underline underline-offset-2 hover:text-foreground"
          >
            Προτεινόμενα προϊόντα
          </Link>
          .
        </p>
      </header>

      <section>
        <h3 className="text-sm font-semibold mb-1.5 flex items-center gap-1.5">
          <ArrowRight className="w-3.5 h-3.5 text-emerald-600" />
          Αυτό το προϊόν προτείνει
        </h3>
        <AssociationsList
          associations={data.sourceMatches}
          empty="Καμία ενεργή συσχέτιση δεν ξεκινά από αυτό το προϊόν."
        />
      </section>

      <section>
        <h3 className="text-sm font-semibold mb-1.5 flex items-center gap-1.5">
          <ArrowDownLeft className="w-3.5 h-3.5 text-sky-600" />
          Αυτό το προϊόν προτείνεται από
        </h3>
        <AssociationsList
          associations={data.targetMatches}
          empty="Κανένα ενεργό καρουζέλ άλλου προϊόντος δεν προτείνει αυτό."
        />
      </section>

      <section className="pt-4 border-t border-border">
        <CreateAssociationFromProductButton
          product_id={productId}
          product_name={productName}
        />
        <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
          Δημιουργείται νέα συσχέτιση με αυτό το προϊόν ως πηγή. Αμέσως μετά
          ανοίγει στο workshop για να ορίσετε στόχο, στρατηγική και τίτλο.
        </p>
      </section>
    </div>
  );
}

function AssociationsList({
  associations,
  empty,
}: {
  associations: RelatedProductsAssociationFull[];
  empty: string;
}) {
  if (associations.length === 0) {
    return <p className="text-xs text-muted-foreground italic">{empty}</p>;
  }
  return (
    <ul className="space-y-1.5">
      {associations.map((a) => {
        const title =
          a.message_title_translations.el ??
          a.message_title_translations.en ??
          null;
        return (
          <li
            key={a.id}
            className="flex items-center gap-2 p-2.5 rounded-md bg-muted/40 border border-border text-sm"
          >
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate">
                {title ? (
                  <>«{title}»</>
                ) : (
                  <span className="text-muted-foreground italic">{a.name}</span>
                )}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {a.name} · θέση {a.display_order} ·{" "}
                {strategyLabel(a.selection_strategy)}
              </p>
            </div>
            <Link
              href={`/admin/related-products?expand=${a.id}`}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ExternalLink className="w-3 h-3" />
              Επεξεργασία
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function strategyLabel(
  s: RelatedProductsAssociationFull["selection_strategy"]
): string {
  switch (s) {
    case "random":
      return "Τυχαία";
    case "recent":
      return "Πιο πρόσφατα";
    case "manual":
      return "Χειροκίνητα";
  }
}
