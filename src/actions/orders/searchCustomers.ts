"use server";

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { fail, ok, type Result } from "@/types/result";

const Schema = z.object({
  q: z.string().trim().min(2).max(200),
  limit: z.number().int().positive().max(20).default(10),
});

export interface CustomerResult {
  customer_id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  source: string;
  has_auth_account: boolean;
}

/**
 * Customer search for the admin "New Order" page and the customers admin
 * list. Matches on email, name, or phone across the unified `customers`
 * table — covering both eshop-signed customers and offline ones. Uses the
 * admin client to bypass per-row RLS (permission already checked above).
 */
export async function searchCustomers(
  input: z.input<typeof Schema>
): Promise<Result<CustomerResult[]>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail<CustomerResult[]>("Invalid input", "INVALID_INPUT");
  if (!(await checkPermission("manage:orders"))) {
    return fail<CustomerResult[]>("Forbidden", "FORBIDDEN");
  }

  const admin = createAdminClient();
  const term = `%${parsed.data.q.replace(/[%_]/g, "\\$&")}%`;

  const { data, error } = await admin
    .from("customers")
    .select("id, email, first_name, last_name, phone, source, auth_user_id")
    .or(
      `email.ilike.${term},first_name.ilike.${term},last_name.ilike.${term},phone.ilike.${term}`
    )
    .order("created_at", { ascending: false })
    .limit(parsed.data.limit);

  if (error) return fail<CustomerResult[]>(error.message, error.code);

  const results: CustomerResult[] = (
    (data ?? []) as Array<{
      id: string;
      email: string | null;
      first_name: string | null;
      last_name: string | null;
      phone: string | null;
      source: string;
      auth_user_id: string | null;
    }>
  ).map((r) => ({
    customer_id: r.id,
    email: r.email,
    first_name: r.first_name,
    last_name: r.last_name,
    phone: r.phone,
    source: r.source,
    has_auth_account: r.auth_user_id !== null,
  }));

  return ok(results);
}
