/**
 * Compatibility re-export. The implementation moved to `src/lib/email/index.ts`
 * with admin-configurable providers (SMTP / Resend, switchable via the
 * `/admin/settings/email` page). This file keeps the original import path
 * working so existing callers (transitionOrderStatus, fulfillOrder, etc.)
 * don't need touching.
 */
export { sendEmail } from "@/lib/email";
export type { SendEmailInput } from "@/lib/email";
export type { SendResult as SendEmailResult } from "@/types/email";
