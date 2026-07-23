import AdminPageHeader from "@/components/admin/common/AdminPageHeader";
import OffersBenchStaticChrome from "@/components/admin/offers/OffersBenchStaticChrome";

/**
 * Navigation-gap loading state for /admin/discounts.
 *
 * Renders the SAME thing the page renders before data arrives:
 * the page header + the bench's static chrome. By matching the
 * page's first-frame output exactly, the transition from this
 * loading state to the page's actual render is visually invisible.
 *
 * Without this file, Next.js would fall back to the generic
 * src/app/admin/loading.tsx (a header placeholder + filter row +
 * row-stack content) which doesn't match the offers page's
 * three-column shape — producing the "two-step load" jump where
 * the user sees a generic skeleton briefly before the structured
 * chrome appears.
 *
 * The two loading gaps in App Router are:
 *   1. Navigation gap — click → first byte. This file fills it.
 *   2. Data gap — chrome rendered → data resolved. The
 *      <Suspense fallback={<OffersBenchStaticChrome />}> in the
 *      page fills it.
 *
 * Both render the same component, so the user perceives one
 * continuous structured paint instead of two distinct skeleton
 * states.
 */
export default function DiscountsLoading() {
  return (
    <>
      <AdminPageHeader
        title="Προσφορές & Κανόνες"
        subtitle={
          <span className="max-w-2xl block">
            Σχεδιάστε προσφορές, κανόνες και κωδικούς σε ένα οπτικό
            workshop. Σύρετε κανόνες πάνω σε προσφορές για ομαδοποίηση,
            ή κωδικούς πάνω σε κανόνες/προσφορές για σύνδεση.
          </span>
        }
      />
      <OffersBenchStaticChrome />
    </>
  );
}
