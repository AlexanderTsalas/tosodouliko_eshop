import SeoMetadataForm from "@/components/admin/seo/SeoMetadataForm";

import { requirePermission } from "@/lib/rbac";

export const metadata = { title: "Νέο SEO record — Admin" };
export const dynamic = "force-dynamic";

export default async function NewSeoPage(
  props: {
    searchParams: Promise<{ type?: string; id?: string }>;
  }
) {
  await requirePermission("manage:seo");
  const searchParams = await props.searchParams;
  const resourceType = searchParams.type ?? "";
  const resourceId = searchParams.id ?? "";

  if (!resourceType || !resourceId) {
    return (
      <>
        <h1 className="text-2xl font-semibold mb-4">Νέο SEO record</h1>
        <p className="text-sm text-muted-foreground mb-4">
          Επιλέξτε τύπο πόρου (resource_type) και αναγνωριστικό (resource_id) ώστε το record να συσχετιστεί.
          Τυπικά: <code>product</code>/<code>&lt;product_id&gt;</code>, <code>category</code>/<code>&lt;category_id&gt;</code>, ή <code>page</code>/<code>about</code>.
        </p>
        <form className="flex gap-2 max-w-lg" method="get">
          <input
            name="type"
            placeholder="resource type (π.χ. product)"
            required
            className="border rounded px-3 py-2 flex-1"
          />
          <input
            name="id"
            placeholder="resource id"
            required
            className="border rounded px-3 py-2 flex-1"
          />
          <button type="submit" className="rounded bg-primary text-primary-foreground px-4 py-2 text-sm">
            Συνέχεια
          </button>
        </form>
      </>
    );
  }

  return (
    <>
      <h1 className="text-2xl font-semibold mb-4">
        Νέο SEO record — <span className="font-mono text-base">{resourceType}/{resourceId}</span>
      </h1>
      <SeoMetadataForm resourceType={resourceType} resourceId={resourceId} />
    </>
  );
}
