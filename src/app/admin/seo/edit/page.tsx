import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SeoMetadataForm from "@/components/admin/seo/SeoMetadataForm";
import type { SeoMetadata } from "@/types/dynamic-seo";

import { requirePermission } from "@/lib/rbac";

export const metadata = { title: "Επεξεργασία SEO — Admin" };
export const dynamic = "force-dynamic";

export default async function EditSeoPage(
  props: {
    searchParams: Promise<{ type?: string; id?: string }>;
  }
) {
  await requirePermission("manage:seo");
  const searchParams = await props.searchParams;
  const resourceType = searchParams.type ?? "";
  const resourceId = searchParams.id ?? "";
  if (!resourceType || !resourceId) notFound();

  const supabase = await createClient();
  const { data } = await supabase
    .from("seo_metadata")
    .select("*")
    .eq("resource_type", resourceType)
    .eq("resource_id", resourceId)
    .maybeSingle();

  return (
    <>
      <h1 className="text-2xl font-semibold mb-4">
        SEO metadata — <span className="font-mono text-base">{resourceType}/{resourceId}</span>
      </h1>
      <SeoMetadataForm
        resourceType={resourceType}
        resourceId={resourceId}
        initial={(data as SeoMetadata) ?? null}
      />
    </>
  );
}
