import { createAdminClient } from "@/lib/supabase/admin";
import type { AuditEventInput } from "@/types/audit-log";

/**
 * Records an audit event. Uses the admin (service-role) client so audit writes
 * succeed regardless of caller's RLS context.
 *
 * Contract:
 * - Must NEVER throw — audit failure must not break the calling operation.
 * - Must NOT be called from client components or hooks.
 */
export async function logAuditEvent(input: AuditEventInput): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.from("audit_events").insert({
      actor_id: input.actor_id ?? null,
      actor_type: input.actor_type,
      action: input.action,
      resource_type: input.resource_type,
      resource_id: input.resource_id ?? null,
      metadata: input.metadata ?? null,
      ip_address: input.ip_address ?? null,
    });
  } catch (err) {
    // Log audit failure is non-fatal. Surface to console so it's visible in dev.
    console.error("[audit] logAuditEvent failed:", err);
  }
}
