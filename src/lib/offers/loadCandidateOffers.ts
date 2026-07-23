import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CandidateRule, EvalContext, Rule } from "@/types/offers";

/**
 * Coarse SQL filter + TS-side code matching + per-code usage limit check
 * (v2.5 — codes standalone, attached via code_attachments).
 *
 * Flow:
 *   1. eligible_rules returns rules whose scope matches + activation passes.
 *   2. For each candidate rule, find the matching code via attachments:
 *      - direct (target_kind='rule', target_id=rule.id), OR
 *      - via parent offer (target_kind='offer', target_id ∈ parent offers)
 *      AND that code is in the customer's typed code set OR auto-applies
 *      via code_customers.auto_apply, AND the customer-whitelist gate
 *      passes if a whitelist exists on that code.
 *   3. Apply per-CODE usage limits (when enforce_limits=true).
 *   4. Drop rules where requires_code=true but no code matched.
 */
export async function loadCandidateOffers(
  ctx: EvalContext
): Promise<CandidateRule[]> {
  const admin = createAdminClient();

  const variantIds = Array.from(new Set(ctx.lines.map((l) => l.variant_id)));
  const productIds = Array.from(new Set(ctx.lines.map((l) => l.product_id)));
  const categoryIds = Array.from(
    new Set(ctx.lines.flatMap((l) => l.category_ids))
  );

  const { data: ruleRows, error } = await admin.rpc("eligible_rules", {
    p_variant_ids: variantIds,
    p_product_ids: productIds,
    p_category_ids: categoryIds,
  });

  if (error) {
    console.error("[offers] loadCandidateOffers failed:", error.message);
    return [];
  }
  if (!ruleRows || ruleRows.length === 0) return [];

  const rules = ruleRows as Rule[];
  const ruleIds = rules.map((r) => r.id);

  // Load parent offers for each rule (for code-via-offer matching).
  const { data: memberships } = await admin
    .from("offer_rule_memberships")
    .select("rule_id, offer_id")
    .in("rule_id", ruleIds);
  const parentOffersByRule = new Map<string, string[]>();
  for (const m of (memberships ?? []) as Array<{
    rule_id: string;
    offer_id: string;
  }>) {
    const list = parentOffersByRule.get(m.rule_id) ?? [];
    list.push(m.offer_id);
    parentOffersByRule.set(m.rule_id, list);
  }
  const allOfferIds = Array.from(
    new Set(
      Array.from(parentOffersByRule.values()).flat()
    )
  );

  // Load code attachments reaching any of these rules (direct + via offers).
  const attachmentsRes = await admin
    .from("code_attachments")
    .select("code_id, target_kind, target_id")
    .or(
      `and(target_kind.eq.rule,target_id.in.(${ruleIds.join(",")}))` +
        (allOfferIds.length > 0
          ? `,and(target_kind.eq.offer,target_id.in.(${allOfferIds.join(",")}))`
          : "")
    );
  type AttachRow = {
    code_id: string;
    target_kind: "rule" | "offer";
    target_id: string;
  };
  const attachments = (attachmentsRes.data ?? []) as AttachRow[];
  const attachedCodeIdsByRule = new Map<string, Set<string>>();
  // Index reverse: for each (target_kind, target_id) collect code_ids.
  const codesByTarget = new Map<string, string[]>();
  for (const a of attachments) {
    const key = `${a.target_kind}:${a.target_id}`;
    const list = codesByTarget.get(key) ?? [];
    list.push(a.code_id);
    codesByTarget.set(key, list);
  }
  for (const rule of rules) {
    const codeIds = new Set<string>();
    for (const id of codesByTarget.get(`rule:${rule.id}`) ?? []) {
      codeIds.add(id);
    }
    for (const offerId of parentOffersByRule.get(rule.id) ?? []) {
      for (const id of codesByTarget.get(`offer:${offerId}`) ?? []) {
        codeIds.add(id);
      }
    }
    attachedCodeIdsByRule.set(rule.id, codeIds);
  }

  // Load all attached codes' full data.
  const allCodeIds = Array.from(
    new Set(
      Array.from(attachedCodeIdsByRule.values()).flatMap((s) => Array.from(s))
    )
  );

  let codes: Array<{
    id: string;
    code: string;
    affiliate_id: string | null;
    max_uses_total: number | null;
    max_uses_per_customer: number | null;
    current_uses: number;
    enforce_limits: boolean;
  }> = [];
  let whitelists: Array<{
    code_id: string;
    customer_id: string;
    auto_apply: boolean;
  }> = [];
  let customerUsageByCode = new Map<string, number>();

  if (allCodeIds.length > 0) {
    const [codesRes, whitelistsRes, customerUsageRes] = await Promise.all([
      admin
        .from("codes")
        .select(
          "id, code, affiliate_id, max_uses_total, max_uses_per_customer, current_uses, enforce_limits"
        )
        .in("id", allCodeIds)
        .eq("active", true),
      admin
        .from("code_customers")
        .select("code_id, customer_id, auto_apply")
        .in("code_id", allCodeIds),
      ctx.customerId
        ? admin
            .from("code_customer_usage")
            .select("code_id, use_count")
            .eq("customer_id", ctx.customerId)
            .in("code_id", allCodeIds)
        : Promise.resolve({
            data: [] as Array<{ code_id: string; use_count: number }>,
          }),
    ]);
    codes = (codesRes.data ?? []) as typeof codes;
    whitelists = (whitelistsRes.data ?? []) as typeof whitelists;
    for (const r of (customerUsageRes.data ?? []) as Array<{
      code_id: string;
      use_count: number;
    }>) {
      customerUsageByCode.set(r.code_id, r.use_count);
    }
  }

  const codeById = new Map(codes.map((c) => [c.id, c]));
  const whitelistByCode = new Map<string, typeof whitelists>();
  for (const w of whitelists) {
    const list = whitelistByCode.get(w.code_id) ?? [];
    list.push(w);
    whitelistByCode.set(w.code_id, list);
  }

  const userCodeSet = new Set(ctx.codes.map((c) => c.toUpperCase().trim()));

  const candidates: CandidateRule[] = [];
  for (const rule of rules) {
    let matched_code_id: string | null = null;
    let matched_affiliate_id: string | null = null;

    const reachableCodeIds = Array.from(
      attachedCodeIdsByRule.get(rule.id) ?? []
    );
    for (const cid of reachableCodeIds) {
      const code = codeById.get(cid);
      if (!code) continue;
      const whitelist = whitelistByCode.get(code.id) ?? [];
      const hasWhitelist = whitelist.length > 0;
      const customerOnWhitelist =
        ctx.customerId !== null &&
        whitelist.some((w) => w.customer_id === ctx.customerId);
      const customerAutoApply =
        ctx.customerId !== null &&
        whitelist.some(
          (w) => w.customer_id === ctx.customerId && w.auto_apply
        );

      const codeEntered = userCodeSet.has(code.code);
      const matches = codeEntered || customerAutoApply;
      if (!matches) continue;

      if (hasWhitelist && !customerOnWhitelist) continue;

      if (code.enforce_limits) {
        if (
          code.max_uses_total !== null &&
          code.current_uses >= code.max_uses_total
        ) {
          continue;
        }
        if (
          code.max_uses_per_customer !== null &&
          ctx.customerId !== null
        ) {
          const used = customerUsageByCode.get(code.id) ?? 0;
          if (used >= code.max_uses_per_customer) continue;
        }
      }

      matched_code_id = code.id;
      matched_affiliate_id = code.affiliate_id;
      break;
    }

    if (rule.requires_code && matched_code_id === null) continue;

    candidates.push({ rule, matched_code_id, matched_affiliate_id });
  }

  return candidates;
}
