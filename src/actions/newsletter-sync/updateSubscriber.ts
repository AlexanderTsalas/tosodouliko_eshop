"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/rbac";
import { fail, ok, type Result } from "@/types/result";
import type { NewsletterSubscriber } from "@/types/newsletter-sync";

const Schema = z.object({
  id: z.string().uuid(),
  status: z.enum(["subscribed", "unsubscribed", "pending"]).optional(),
  metadata: z.record(z.unknown()).nullable().optional(),
});

export async function updateSubscriber(
  input: z.input<typeof Schema>
): Promise<Result<NewsletterSubscriber>> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return fail<NewsletterSubscriber>("Invalid input", "INVALID_INPUT");
  if (!(await checkPermission("manage:newsletter"))) {
    return fail<NewsletterSubscriber>("Forbidden", "FORBIDDEN");
  }

  const update: Record<string, unknown> = {};
  if (parsed.data.status !== undefined) {
    update.status = parsed.data.status;
    if (parsed.data.status === "unsubscribed") {
      update.unsubscribed_at = new Date().toISOString();
    } else if (parsed.data.status === "subscribed") {
      update.unsubscribed_at = null;
    }
  }
  if (parsed.data.metadata !== undefined) update.metadata = parsed.data.metadata;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("newsletter_subscribers")
    .update(update)
    .eq("id", parsed.data.id)
    .select()
    .single();

  if (error || !data) {
    return fail<NewsletterSubscriber>(error?.message ?? "Update failed", error?.code);
  }
  revalidatePath("/admin/newsletter");
  return ok(data as unknown as NewsletterSubscriber);
}
