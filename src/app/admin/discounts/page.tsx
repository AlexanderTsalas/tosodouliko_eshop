import { Suspense } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import AdminPageHeader from "@/components/admin/common/AdminPageHeader";
import OffersLabBench from "@/components/admin/offers/OffersLabBench";
import OffersBenchStaticChrome from "@/components/admin/offers/OffersBenchStaticChrome";
import type {
  Affiliate,
  Code,
  CodeAttachment,
  Offer,
  Rule,
  RuleAction,
  RuleCondition,
  RuleScope,
} from "@/types/offers";
import type { Category } from "@/types/category-navigation";
import { requirePermission } from "@/lib/rbac";

export const metadata = { title: "Προσφορές — Admin" };
export const dynamic = "force-dynamic";

/**
 * Proof-of-concept for the "static chrome, suspend the data" pattern.
 *
 * Before: the page handler awaited 9 parallel Supabase queries before
 * rendering anything. The customer saw a blank tab for the full
 * Promise.all duration (often 300-600ms).
 *
 * After: the page handler runs only the permission check and returns
 * the structural chrome — the header + subtitle — immediately. The
 * 9-query fan-out lives in <OffersBenchData /> below, wrapped in
 * <Suspense> with a skeleton that matches the bench's 3-column shape.
 *
 * Wider chrome extraction (search bar, filter chips, column titles,
 * "+ New" buttons) would require decomposing OffersLabBench itself —
 * those elements currently sit inside the bench client component
 * because they share state with the data-bearing parts. Doing it
 * properly is a separate refactor; this PoC delivers the header-paints-
 * instantly win without that risk.
 */
export default async function AdminDiscountsPage() {
  await requirePermission("manage:discounts");

  return (
    <>
      {/* Chrome — renders immediately, no DB work happens here. */}
      <AdminPageHeader
        title="Προσφορές & Κανόνες"
        subtitle={
          <span className="max-w-2xl block">
            Σχεδιάστε προσφορές, κανόνες και κωδικούς σε ένα οπτικό
            workshop. Σύρετε κανόνες πάνω σε προσφορές για ομαδοποίηση,
            ή κωδικούς πάνω σε κανόνες/προσφορές για σύνδεση.
          </span>
        }
      />

      {/* Data — suspended. Fallback is <OffersBenchStaticChrome />:
          a non-interactive replica of the live bench's structure
          (search bar, filter chips, three column headers with the
          right icons + titles + helper text, "+ New" dashed cards,
          and card-shaped placeholders). Because the fallback uses
          the same DOM structure + classes the live bench will use,
          the swap from fallback to live is nearly invisible — only
          the card contents change and the controls become
          interactive. */}
      <Suspense fallback={<OffersBenchStaticChrome />}>
        <OffersBenchData />
      </Suspense>
    </>
  );
}

/**
 * Async server component that does the actual data work and renders
 * the bench. Kept inside the same file as the page handler for now —
 * it's tightly coupled to the page's domain. If the data shaping
 * grows, lift to its own file.
 */
async function OffersBenchData() {
  const admin = createAdminClient();

  const [
    rulesRes,
    offersRes,
    scopesRes,
    attachmentsRes,
    conditionsRes,
    actionsRes,
    membershipsRes,
    catRes,
    affRes,
  ] = await Promise.all([
    admin.from("rules").select("*").order("created_at", { ascending: false }),
    admin.from("offers").select("*").order("created_at", { ascending: false }),
    admin.from("rule_scopes").select("*"),
    admin
      .from("code_attachments")
      .select("id, code_id, target_kind, target_id, added_at, added_by, codes(*)")
      .order("added_at"),
    admin.from("rule_conditions").select("*").order("created_at"),
    admin.from("rule_actions").select("*"),
    admin.from("offer_rule_memberships").select("rule_id, offer_id"),
    admin
      .from("categories")
      .select("*")
      .eq("active", true)
      .order("display_order"),
    admin.from("affiliates").select("*").eq("active", true).order("name"),
  ]);

  const rules = (rulesRes.data ?? []) as Rule[];
  const offers = (offersRes.data ?? []) as Offer[];

  const scopesByRule: Record<string, RuleScope[]> = {};
  for (const s of (scopesRes.data ?? []) as RuleScope[]) {
    (scopesByRule[s.rule_id] ??= []).push(s);
  }

  // ─── Codes + attachments ──────────────────────────────────────────
  type RawAttach = {
    id: string;
    code_id: string;
    target_kind: "rule" | "offer";
    target_id: string;
    added_at: string;
    added_by: string | null;
    codes: Code | Code[] | null;
  };
  const rawAttachments = (attachmentsRes.data ?? []) as RawAttach[];
  const normalized = rawAttachments.map((r) => ({
    id: r.id,
    code_id: r.code_id,
    target_kind: r.target_kind,
    target_id: r.target_id,
    added_at: r.added_at,
    added_by: r.added_by,
    code: Array.isArray(r.codes) ? r.codes[0] : r.codes,
  }));

  const allCodes: Code[] = [];
  const seenCodeIds = new Set<string>();
  const codesByRule: Record<string, Code[]> = {};
  const codesByOffer: Record<string, Code[]> = {};
  const attachmentsByCode: Record<string, CodeAttachment[]> = {};
  for (const a of normalized) {
    if (!a.code) continue;
    if (!seenCodeIds.has(a.code.id)) {
      seenCodeIds.add(a.code.id);
      allCodes.push(a.code);
    }
    if (a.target_kind === "rule") {
      (codesByRule[a.target_id] ??= []).push(a.code);
    } else {
      (codesByOffer[a.target_id] ??= []).push(a.code);
    }
    (attachmentsByCode[a.code_id] ??= []).push({
      id: a.id,
      code_id: a.code_id,
      target_kind: a.target_kind,
      target_id: a.target_id,
      added_at: a.added_at,
      added_by: a.added_by,
    });
  }

  const conditionsByRule: Record<string, RuleCondition[]> = {};
  for (const c of (conditionsRes.data ?? []) as RuleCondition[]) {
    (conditionsByRule[c.rule_id] ??= []).push(c);
  }
  const membershipsByRule: Record<string, string[]> = {};
  for (const m of (membershipsRes.data ?? []) as Array<{
    rule_id: string;
    offer_id: string;
  }>) {
    (membershipsByRule[m.rule_id] ??= []).push(m.offer_id);
  }
  const actionByRule: Record<string, RuleAction> = {};
  for (const a of (actionsRes.data ?? []) as RuleAction[]) {
    actionByRule[a.rule_id] = a;
  }

  // No fade-in wrapper here: the static chrome (OffersBenchStaticChrome)
  // and the live OffersLabBench are designed to look visually
  // identical at the swap moment — toolbar, column titles, "+ New"
  // buttons are class-for-class matched. A fade-in on the live bench
  // would visually re-render those identical elements, defeating the
  // "instant chrome" intent.
  return (
    <OffersLabBench
      offers={offers}
      rules={rules}
      codes={allCodes}
      scopesByRule={scopesByRule}
      codesByRule={codesByRule}
      codesByOffer={codesByOffer}
      attachmentsByCode={attachmentsByCode}
      conditionsByRule={conditionsByRule}
      actionByRule={actionByRule}
      membershipsByRule={membershipsByRule}
      categories={(catRes.data ?? []) as Category[]}
      affiliates={(affRes.data ?? []) as Affiliate[]}
    />
  );
}

// Static chrome moved to its own file:
//   src/components/admin/offers/OffersBenchStaticChrome.tsx
// — it mirrors the bench's exact toolbar + column structure so the
// swap from fallback to live bench is nearly invisible.
