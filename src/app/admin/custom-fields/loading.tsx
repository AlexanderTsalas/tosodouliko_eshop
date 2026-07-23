import AdminPageHeader from "@/components/admin/common/AdminPageHeader";
import CustomFieldsBenchStaticChrome from "@/components/admin/custom-fields/CustomFieldsBenchStaticChrome";

/**
 * Navigation-gap loading state for /admin/custom-fields.
 *
 * Renders the SAME chrome the page handler renders + the same
 * static bench shape the page's Suspense fallback uses. By matching
 * the first-frame output exactly, the transition from this loading
 * state to the page's actual render is visually invisible.
 */
export default function CustomFieldsLoading() {
  return (
    <>
      <AdminPageHeader
        title="Πεδία πελάτη"
        subtitle={
          <span className="max-w-2xl block">
            Δημιουργήστε επαναχρησιμοποιήσιμα πεδία (μήνυμα δώρου, στυλ
            χάραξης, μέτρα κ.λπ.) που γεμίζει ο πελάτης πριν την αγορά.
            Ομαδοποιήστε τα και συνδέστε τα σε κατηγορίες, προϊόντα ή
            παραλλαγές.
          </span>
        }
      />
      <CustomFieldsBenchStaticChrome />
    </>
  );
}
