"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Wraps children with a pathname-keyed div so React unmounts and
 * remounts the page content on every navigation. The remount fires
 * the `.page-enter` CSS animation (defined in globals.css), which
 * gives a brief fade-in for each new page.
 *
 * The wrapper itself doesn't unmount — only the inner keyed div
 * does — so layout chrome (the admin sidebar, the storefront
 * header) stays painted between navigations and only the page
 * content area transitions.
 *
 * Why a client component: we need `usePathname()`, which is
 * client-only. The wrapper is intentionally minimal — it doesn't
 * fetch data or own state, so the JS payload is trivial.
 *
 * Why fade-in only, no fade-out: doing a proper fade-out → navigate →
 * fade-in sequence would require intercepting Link clicks (delay
 * router.push until the exit animation plays) OR using the browser's
 * View Transitions API. An earlier attempt that stored old children
 * in React state and animated after-the-fact produced a wrong-order
 * artifact — the new content rendered first, then the fade played
 * around it. Fade-in only is the clean fallback until we wire one of
 * those two proper approaches.
 *
 * Why a key prop, not a CSS-only solution: pure CSS @starting-style
 * + transition only fires on element MOUNT. With Next.js client-
 * navigation, the page content div doesn't remount unless something
 * changes its identity — the pathname key does that.
 */
export default function PageTransitionWrapper({
  children,
}: {
  children: ReactNode;
}) {
  const pathname = usePathname();
  return (
    <div key={pathname} className="page-enter">
      {children}
    </div>
  );
}
