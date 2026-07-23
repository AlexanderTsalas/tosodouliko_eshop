"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "@/actions/auth/signIn";
import { mergeAnonCart } from "@/actions/cart/mergeAnonCart";
import { createClient } from "@/lib/supabase/client";
import { normalizeEmail } from "@/lib/forms/normalize";

export default function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      // Phase 9C: capture the anonymous user id (if any) BEFORE the auth
      // swap so we can merge their cart into the permanent account after
      // sign-in succeeds. After signInWithPassword runs, the cookie is
      // replaced and we lose access to the old uid.
      let anonUserId: string | null = null;
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getUser();
        if (data.user?.is_anonymous) anonUserId = data.user.id;
      } catch {
        // Best-effort — failing to capture means we just skip the merge.
      }

      const r = await signIn({
        // Normalize email so the lookup matches the canonical stored form
        // regardless of how the user typed it.
        email: normalizeEmail(String(formData.get("email") ?? "")),
        password: String(formData.get("password") ?? ""),
        company: String(formData.get("company") ?? ""),
      });
      if (!r.success) {
        setError(r.error);
        return;
      }

      if (anonUserId) {
        // Best-effort merge — never blocks the sign-in success path.
        await mergeAnonCart({ anon_user_id: anonUserId });
      }

      router.push("/");
      router.refresh();
    });
  }

  return (
    <form action={handleSubmit} className="flex flex-col gap-3 max-w-sm">
      {/* Honeypot — visually hidden, screen-reader hidden, not focusable.
          Bots filling all inputs fail the action. Position offscreen rather
          than display:none so naive bots scraping the DOM still see it. */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          left: "-9999px",
          width: "1px",
          height: "1px",
          overflow: "hidden",
        }}
      >
        <label>
          Εταιρεία (μην συμπληρώσετε)
          <input
            type="text"
            name="company"
            tabIndex={-1}
            autoComplete="off"
            defaultValue=""
          />
        </label>
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-sm">Email</span>
        <input
          name="email"
          type="email"
          required
          className="border rounded px-3 py-2"
          autoComplete="email"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm">Κωδικός</span>
        <input
          name="password"
          type="password"
          required
          className="border rounded px-3 py-2"
          autoComplete="current-password"
        />
      </label>
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      <button
        type="submit"
        disabled={isPending}
        className="rounded bg-primary text-primary-foreground py-2 disabled:opacity-50"
      >
        {isPending ? "Σύνδεση..." : "Σύνδεση"}
      </button>
    </form>
  );
}
