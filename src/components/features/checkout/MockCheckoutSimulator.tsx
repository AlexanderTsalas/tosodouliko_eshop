"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface Props {
  orderId: string;
  orderNumber: string;
  sessionId: string;
  amount: number | string;
  currency: string;
}

/**
 * Stand-in for Stripe's hosted checkout page when running with the mock
 * provider. Renders "Simulate success / Simulate decline" buttons that POST
 * to the mock-payment webhook, mimicking the events Stripe would emit
 * (`checkout.session.completed` for success, `checkout.session.async_payment_failed`
 * for failure).
 *
 * The webhook fires the same shared handlers the real Stripe webhook would,
 * so the order moves through identical state regardless of provider.
 *
 * When real Stripe is wired up (`STRIPE_SECRET_KEY` set), the customer never
 * sees this page — they're redirected to checkout.stripe.com instead.
 */
export default function MockCheckoutSimulator({
  orderId,
  orderNumber,
  sessionId,
  amount,
  currency,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function simulate(outcome: "completed" | "failed", reason?: string) {
    setError(null);
    startTransition(async () => {
      const r = await fetch("/api/webhooks/mock-payment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          outcome,
          session_id: sessionId,
          reason,
        }),
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `HTTP ${r.status}`);
        return;
      }
      if (outcome === "completed") {
        router.replace(`/checkout/success/${orderId}`);
      } else {
        router.replace(`/cart`);
      }
    });
  }

  return (
    <div className="border rounded p-4 space-y-3 bg-amber-50 border-amber-300">
      <header>
        <p className="text-xs font-mono text-amber-900">🧪 TEST PAYMENT MODE</p>
        <p className="text-sm text-amber-900 mt-1">
          Stripe δεν είναι ενεργοποιημένο σε αυτό το περιβάλλον. Χρησιμοποιήστε
          τα κουμπιά παρακάτω για να προσομοιώσετε την έκβαση της πληρωμής.
          Σε production, εδώ θα εμφανίζεται η σελίδα Stripe Checkout.
        </p>
      </header>

      <dl className="text-xs text-amber-900/80 space-y-0.5">
        <div className="flex justify-between">
          <dt>Παραγγελία:</dt>
          <dd className="font-mono">{orderNumber}</dd>
        </div>
        <div className="flex justify-between">
          <dt>Ποσό:</dt>
          <dd className="font-mono">
            {Number(amount).toFixed(2)} {currency.toUpperCase()}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt>Session:</dt>
          <dd className="font-mono">{sessionId.slice(0, 32)}…</dd>
        </div>
      </dl>

      <div className="flex gap-2 pt-2">
        <button
          type="button"
          onClick={() => simulate("completed")}
          disabled={isPending}
          className="flex-1 rounded bg-emerald-600 text-white px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {isPending ? "..." : "✓ Simulate successful payment"}
        </button>
        <button
          type="button"
          onClick={() => simulate("failed", "Mock decline (insufficient funds)")}
          disabled={isPending}
          className="flex-1 rounded border border-destructive text-destructive px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {isPending ? "..." : "✗ Simulate declined payment"}
        </button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
