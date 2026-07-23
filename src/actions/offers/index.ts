/**
 * Offers engine v2.1 (Path A) — server actions barrel.
 *
 * Entity families:
 *   - Offers: createOffer, updateOffer, deactivateOffer (slim labels)
 *   - Rules: createRule (slim), updateRule (slim), deleteRule
 *   - Rule conditions (NEW): createRuleCondition, updateRuleCondition,
 *     deleteRuleCondition — typed, jsonb-configured, extensible
 *   - Rule scopes: setRuleScopes
 *   - Rule codes: createRuleCode, deleteRuleCode
 *   - M2M offer-rule membership: assignRuleToOffer, unassignRuleFromOffer,
 *     groupRulesIntoOffer (bulk grouping for the multi-select flow)
 *
 * All actions enforce the 4-layer RBAC defense: RLS, checkPermission,
 * audit log, UI guards.
 */

// Offer-side
export { createOffer } from "./createOffer";
export { updateOffer } from "./updateOffer";
export { deactivateOffer } from "./deactivateOffer";
export { deleteOffer } from "./deleteOffer";

// Rule-side (slim)
export { createRule } from "./createRule";
export { updateRule } from "./updateRule";
export { deleteRule } from "./deleteRule";

// Actions (first-class, typed — v2.4)
export { setRuleAction } from "./setRuleAction";

// Conditions (first-class, typed)
export { createRuleCondition } from "./createRuleCondition";
export { updateRuleCondition } from "./updateRuleCondition";
export { deleteRuleCondition } from "./deleteRuleCondition";

// Scopes
export { setRuleScopes } from "./setRuleScopes";

// Codes — standalone (v2.5)
export { createCode } from "./createCode";
export { updateCode } from "./updateCode";
export { deleteCode } from "./deleteCode";
export { attachCode } from "./attachCode";
export { detachCode } from "./detachCode";

// Legacy code actions — deprecated, kept temporarily for callers
export { createRuleCode } from "./createRuleCode";
export { updateRuleCode } from "./updateRuleCode";
export { deleteRuleCode } from "./deleteRuleCode";

// M2M membership management
export { assignRuleToOffer } from "./assignRuleToOffer";
export { unassignRuleFromOffer } from "./unassignRuleFromOffer";
export { groupRulesIntoOffer } from "./groupRulesIntoOffer";

// Preview / simulation
export { previewEvaluation } from "./previewEvaluation";
export { traceRule } from "./traceRule";
export type { RuleTrace, TraceStep } from "./traceRule";

