"use client";

import { useState } from "react";
import { subscribeNewsletter } from "@/actions/newsletter-sync/subscribeNewsletter";
import { strings } from "@/config/strings";

/**
 * Footer newsletter signup — wired to the existing subscribeNewsletter action
 * (with its honeypot field). Lives in the footer (outside .storefront-root),
 * so its input is styled explicitly rather than by the global form rule.
 */
export default function NewsletterForm() {
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState(""); // honeypot — real users leave empty
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "error">("idle");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    setStatus("loading");
    const r = await subscribeNewsletter({ email, company: company || undefined });
    if (r.success) {
      setStatus("ok");
      setEmail("");
    } else {
      setStatus("error");
    }
  }

  if (status === "ok") {
    return (
      <p className="mt-3 text-sm text-terracotta font-medium">
        {strings.layout.footer.newsletterSuccess}
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-3">
      <div className="flex gap-2">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={strings.layout.footer.newsletterPlaceholder}
          aria-label={strings.layout.footer.newsletterPlaceholder}
          className="flex-1 min-w-0 border border-stone-taupe/30 rounded-sm bg-card px-3 py-2 text-sm text-ink focus:outline-none focus:border-stone-taupe"
        />
        <button
          type="submit"
          disabled={status === "loading"}
          className="shrink-0 bg-terracotta text-canvas px-3 py-2 rounded-sm text-sm font-medium hover:bg-terracotta/90 transition-colors disabled:opacity-60"
        >
          {status === "loading" ? "…" : strings.layout.footer.newsletterCta}
        </button>
      </div>
      {/* Honeypot — visually hidden, off the tab order */}
      <input
        type="text"
        tabIndex={-1}
        autoComplete="off"
        value={company}
        onChange={(e) => setCompany(e.target.value)}
        className="hidden"
        aria-hidden="true"
      />
      {status === "error" && (
        <p className="mt-2 text-xs text-destructive">{strings.layout.footer.newsletterError}</p>
      )}
    </form>
  );
}
