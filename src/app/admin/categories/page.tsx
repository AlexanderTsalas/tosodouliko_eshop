import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/features/backoffice-shell/PageHeader";
import CategoryDeleteButton from "@/components/admin/categories/CategoryDeleteButton";
import { Pencil } from "@/components/admin/common/icons";
import type { Category } from "@/types/category-navigation";

import { requirePermission } from "@/lib/rbac";

export const metadata = { title: "Κατηγορίες — Admin" };
export const dynamic = "force-dynamic";

interface TreeNode extends Category {
  children: TreeNode[];
}

function buildTree(categories: Category[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  for (const c of categories) map.set(c.id, { ...c, children: [] });

  const roots: TreeNode[] = [];
  for (const c of categories) {
    const node = map.get(c.id)!;
    if (c.parent_id && map.has(c.parent_id)) {
      map.get(c.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortFn = (a: TreeNode, b: TreeNode) =>
    a.display_order - b.display_order || a.name.localeCompare(b.name);
  const sortRecursive = (nodes: TreeNode[]) => {
    nodes.sort(sortFn);
    nodes.forEach((n) => sortRecursive(n.children));
  };
  sortRecursive(roots);
  return roots;
}

function TreeRow({ node, depth }: { node: TreeNode; depth: number }) {
  return (
    <li>
      <div
        className={`flex items-center justify-between gap-3 py-2.5 border-b border-foreground/10 hover:bg-muted/20 transition-colors px-3 ${
          !node.active ? "opacity-60" : ""
        }`}
        style={{ paddingLeft: depth * 20 + 12 }}
      >
        <div className="min-w-0 flex items-center gap-2">
          {depth > 0 && (
            <span className="text-muted-foreground text-xs" aria-hidden>
              └
            </span>
          )}
          <span className={`font-medium ${node.active ? "" : "line-through"}`}>
            {node.name}
          </span>
          <span className="text-xs text-muted-foreground font-mono truncate">
            {node.slug}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Link
            href={`/admin/categories/${node.id}/edit`}
            className="btn btn-secondary btn-sm"
          >
            <Pencil className="w-3.5 h-3.5" />
            Επεξεργασία
          </Link>
          <CategoryDeleteButton id={node.id} />
        </div>
      </div>
      {node.children.length > 0 && (
        <ul>
          {node.children.map((c) => (
            <TreeRow key={c.id} node={c} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

export default async function AdminCategoriesPage() {
  await requirePermission("manage:categories");
  const supabase = await createClient();
  const { data } = await supabase
    .from("categories")
    .select("*")
    .order("display_order");

  const tree = buildTree((data ?? []) as Category[]);

  return (
    <>
      <PageHeader
        title="Κατηγορίες"
        description="Ιεραρχικό δέντρο κατηγοριών. Παιδιά εμφανίζονται με εσοχή. Ανενεργές κατηγορίες είναι αμυδρές."
        actions={
          <Link href="/admin/categories/new" className="btn btn-primary btn-md">
            <span className="text-base leading-none">+</span> Νέα κατηγορία
          </Link>
        }
      />

      {tree.length === 0 ? (
        <div className="cms-empty">Δεν υπάρχουν κατηγορίες.</div>
      ) : (
        <div className="border border-foreground/10 rounded-lg overflow-hidden">
          <ul>
            {tree.map((n) => (
              <TreeRow key={n.id} node={n} depth={0} />
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
