"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit-log";
import { loadCarrierProvider } from "@/lib/courier/registry";
import { checkRateLimit } from "@/lib/rate-limit";
import { fail, ok, type Result } from "@/types/result";
import type { Carrier } from "@/types/order-history";

const Schema = z.object({
  /** The configuration row to test. Must be is_active=true to be reachable. */
  id: z.string().uuid(),
});

interface TestResult {
  ok: boolean;
  message: string | null;
}

/**
 * Runs the provider's testConnection() and persists the outcome on the
 * config row (last_test_at/status/message) so the list view can show the
 * latest health without rerunning.
 *
 * Looks up the carrier via the row id, then dispatches through the registry
 * — meaning the row MUST be is_active=true. Forces a temporary activation
 * before running would risk decrypting stale credentials, so we keep the
 * UI flow simple: save → activate → test.
 */
export async function testCarrierProvider(
  input: z.input<typeof Schema>
): Promise<Result<TestResult>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail<TestResult>("Invalid input", "INVALID_INPUT");
  if (!(await checkPermission("manage:couriers"))) {
    return fail<TestResult>("Forbidden", "FORBIDDEN");
  }
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return fail<TestResult>("Not authenticated", "UNAUTHENTICATED");

  // Each test call hits the carrier's API — quota-limited externally.
  // Limit per admin to prevent accidental hammering during config-debug
  // or a compromised admin session draining the courier's API quota.
  const rl = await checkRateLimit({
    key: `carrier-test:${authData.user.id}`,
    limit: 10,
    windowMs: 60_000,
  });
  if (!rl.allowed) {
    return fail<TestResult>(
      "Too many test calls — wait a minute and retry",
      "RATE_LIMITED"
    );
  }

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("carrier_provider_configs")
    .select("id, carrier, is_active")
    .eq("id", parsed.data.id)
    .maybeSingle();
  if (!row) return fail<TestResult>("Provider config not found", "NOT_FOUND");
  const conf = row as { id: string; carrier: Carrier; is_active: boolean };
  if (!conf.is_active) {
    return fail<TestResult>(
      "Ενεργοποιήστε τη ρύθμιση πριν το test (μόνο η ενεργή ρύθμιση καλείται).",
      "NOT_ACTIVE"
    );
  }

  const result = await (async () => {
    const provider = await loadCarrierProvider(conf.carrier);
    if (!provider) {
      return {
        ok: false,
        message:
          "Απέτυχε η φόρτωση του provider. Ελέγξτε CARRIER_SECRETS_KEY και αποθηκεύστε ξανά τα credentials.",
      };
    }
    return provider.testConnection();
  })();

  await admin
    .from("carrier_provider_configs")
    .update({
      last_test_at: new Date().toISOString(),
      last_test_status: result.ok ? "success" : "failure",
      last_test_message: result.message ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", conf.id);

  await logAuditEvent({
    actor_id: authData.user.id,
    actor_type: "user",
    action: "carrier_provider.tested",
    resource_type: "carrier_provider_config",
    resource_id: conf.id,
    metadata: {
      carrier: conf.carrier,
      ok: result.ok,
      message: result.message ?? null,
    },
  });

  revalidatePath("/admin/settings/couriers");
  return ok<TestResult>({ ok: result.ok, message: result.message ?? null });
}
