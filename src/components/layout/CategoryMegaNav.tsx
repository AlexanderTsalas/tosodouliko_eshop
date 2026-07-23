import Link from "next/link";
import { ChevronDown } from "lucide-react";
import type { CategoryTreeNode } from "@/types/category-navigation";
import { strings } from "@/config/strings";

/**
 * Desktop category mega-nav. Server component — the dropdowns are pure CSS
 * (group-hover), so no client JS ships. Renders root categories inline; any
 * root with children reveals a panel listing its children (and grandchildren
 * grouped two-up) plus a "show all" link. Childless roots are plain links.
 * Every link points at the existing /products?category=<slug> route.
 */
export default function CategoryMegaNav({ tree }: { tree: CategoryTreeNode[] }) {
  if (tree.length === 0) return null;

  return (
    <nav
      aria-label={strings.categories.navAriaLabel}
      className="hidden lg:flex items-center gap-6 xl:gap-8 text-[12px] uppercase tracking-widest font-bold text-ink"
    >
      {tree.map((root) => {
        const hasChildren = root.children.length > 0;
        return (
          <div key={root.id} className="relative group/nav">
            <Link
              href={`/products?category=${root.slug}`}
              className="hover:text-terracotta py-2 flex items-center gap-1 transition-colors"
            >
              <span>{root.name}</span>
              {hasChildren && <ChevronDown className="w-3 h-3" />}
            </Link>

            {hasChildren && (
              <div className="absolute top-full left-0 mt-1 min-w-[16rem] bg-canvas border border-stone-taupe/20 shadow-xl opacity-0 invisible translate-y-1 group-hover/nav:opacity-100 group-hover/nav:visible group-hover/nav:translate-y-0 transition-all duration-300 p-5 rounded-sm z-50">
                <div className="absolute inset-1.5 border border-stone-taupe/10 pointer-events-none" />
                <div className="relative z-10 space-y-4 text-left">
                  {root.children.map((child) => (
                    <div key={child.id}>
                      <Link
                        href={`/products?category=${child.slug}`}
                        className="block text-[11px] font-mono text-stone-taupe border-b border-stone-taupe/15 pb-1 uppercase hover:text-terracotta transition-colors"
                      >
                        {child.name}
                      </Link>
                      {child.children.length > 0 && (
                        <div className="grid grid-cols-2 gap-1.5 mt-2 font-normal text-xs text-ink/80 normal-case tracking-normal">
                          {child.children.map((gc) => (
                            <Link
                              key={gc.id}
                              href={`/products?category=${gc.slug}`}
                              className="hover:text-terracotta transition-colors"
                            >
                              {gc.name}
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                  <Link
                    href={`/products?category=${root.slug}`}
                    className="block text-center text-[10px] font-mono text-terracotta bg-warm-sand/40 py-2 hover:bg-terracotta hover:text-canvas transition-colors uppercase tracking-widest rounded-sm"
                  >
                    {strings.categories.allLabel}
                  </Link>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
