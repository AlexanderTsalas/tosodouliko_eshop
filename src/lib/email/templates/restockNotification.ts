/**
 * Phase 6 — wishlist restock notification email.
 *
 * Per spec §9.6, the copy must:
 *   - identify the product (name, price, image)
 *   - state the original wishlist date so months-old subscribers understand
 *     why they're hearing now
 *   - disclose the 30-min priority hold clearly
 *   - state honestly that the offer is non-guaranteed if they don't act
 *   - include a one-click order CTA and an unsubscribe link
 */

export interface RestockNotificationInput {
  customer_first_name: string | null;
  product_name: string;
  variant_label: string | null;
  product_url: string;
  unsubscribe_url: string;
  /** Display string for the variant price (already currency-formatted). */
  price_label: string;
  /** ISO date when the wishlist entry was created. */
  wishlisted_at: string;
  /** Priority-hold duration in minutes (default 30). */
  hold_minutes?: number;
  /** Optional product image URL for the email body. */
  image_url?: string | null;
}

export interface RestockNotificationOutput {
  subject: string;
  text: string;
  html: string;
}

export function renderRestockNotification(
  input: RestockNotificationInput
): RestockNotificationOutput {
  const greeting = input.customer_first_name
    ? `Γεια σας ${input.customer_first_name},`
    : "Γεια σας,";
  const holdMinutes = input.hold_minutes ?? 30;
  const wishlistedDate = formatGreekDate(input.wishlisted_at);
  const variantSuffix = input.variant_label ? ` (${input.variant_label})` : "";

  const subject = `Καλά νέα — το «${input.product_name}» είναι ξανά διαθέσιμο`;

  const text = [
    greeting,
    "",
    `Το προϊόν που είχατε προσθέσει στη λίστα επιθυμιών σας στις ${wishlistedDate} είναι ξανά διαθέσιμο:`,
    "",
    `${input.product_name}${variantSuffix}`,
    `Τιμή: ${input.price_label}`,
    "",
    `⏱ ΠΡΟΤΕΡΑΙΟΤΗΤΑ ΓΙΑ ΕΣΑΣ ΓΙΑ ${holdMinutes} ΛΕΠΤΑ`,
    `Έχετε αποκλειστική προτεραιότητα για ${holdMinutes} λεπτά. Αν δεν προλάβετε,`,
    "η ευκαιρία θα περάσει στον επόμενο πελάτη που περιμένει στη λίστα.",
    "Δεν εγγυόμαστε ότι το προϊόν θα είναι διαθέσιμο αν περιμένετε.",
    "",
    `Παραγγείλετε τώρα: ${input.product_url}`,
    "",
    `Αν δεν σας ενδιαφέρει πλέον, αφαιρέστε από τη λίστα σας: ${input.unsubscribe_url}`,
  ].join("\n");

  const html = `<!doctype html>
<html lang="el">
  <body style="font-family: system-ui, -apple-system, sans-serif; line-height: 1.5; color: #1a1a1a; max-width: 560px; margin: 0 auto; padding: 24px;">
    <p>${escapeHtml(greeting)}</p>
    <p>Το προϊόν που είχατε προσθέσει στη λίστα επιθυμιών σας στις <strong>${escapeHtml(wishlistedDate)}</strong> είναι ξανά διαθέσιμο:</p>
    ${
      input.image_url
        ? `<p style="text-align:center"><img src="${escapeAttr(input.image_url)}" alt="${escapeAttr(input.product_name)}" style="max-width: 200px; border-radius: 8px;" /></p>`
        : ""
    }
    <p style="font-size: 1.05em;"><strong>${escapeHtml(input.product_name)}</strong>${escapeHtml(variantSuffix)}<br/>
    Τιμή: <strong>${escapeHtml(input.price_label)}</strong></p>
    <div style="border: 1px solid #f59e0b; background: #fffbeb; padding: 12px 16px; border-radius: 6px; margin: 16px 0;">
      <p style="margin: 0 0 6px 0;"><strong>⏱ ΠΡΟΤΕΡΑΙΟΤΗΤΑ ΓΙΑ ΕΣΑΣ ΓΙΑ ${holdMinutes} ΛΕΠΤΑ</strong></p>
      <p style="margin: 0; font-size: 0.95em;">Έχετε αποκλειστική προτεραιότητα για ${holdMinutes} λεπτά. Αν δεν προλάβετε, η ευκαιρία θα περάσει στον επόμενο πελάτη που περιμένει στη λίστα. Δεν εγγυόμαστε ότι το προϊόν θα είναι διαθέσιμο αν περιμένετε.</p>
    </div>
    <p style="text-align: center; margin: 24px 0;">
      <a href="${escapeAttr(input.product_url)}" style="display: inline-block; background: #1a1a1a; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600;">Παραγγείλετε τώρα →</a>
    </p>
    <p style="font-size: 0.85em; color: #6b7280;">Αν δεν σας ενδιαφέρει πλέον, <a href="${escapeAttr(input.unsubscribe_url)}" style="color: #6b7280;">αφαιρέστε από τη λίστα σας</a>.</p>
  </body>
</html>`;

  return { subject, text, html };
}

function formatGreekDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("el-GR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}
