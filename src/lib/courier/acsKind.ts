/**
 * ACS-specific mapping between ACS_SHOP_KIND integer codes
 * (used in the ACS API) and the semantic `kind` text values stored in
 * the unified `couriers_location_cache` table.
 *
 * Why centralize: every code path that writes to or queries the cache needs
 * the same mapping. Drifting per file is what made the previous per-carrier
 * cache pattern brittle.
 *
 * Other carriers maintain their own helper if they need one (BoxNow has only
 * 'locker'; Geniki distinguishes 'shop' vs 'locker'). Cross-carrier code
 * compares only the text values.
 */

export type AcsKind =
  | "central_store"
  | "branch"
  | "xpress"
  | "kiosk"
  | "smartpoint";

export function acsKindFromShopKind(shopKind: number): AcsKind {
  switch (shopKind) {
    case 1:
      return "central_store";
    case 2:
    case 3:
      return "branch";
    case 4:
      return "xpress";
    case 5:
      return "kiosk";
    case 7:
      return "smartpoint";
    default:
      // Fall back to central_store so the caller still finds *something*
      // rather than silently filtering out unrecognized rows. ACS has not
      // introduced a new kind in years; if they do, this surfaces it.
      return "central_store";
  }
}

export function acsShopKindFromKind(kind: AcsKind | string): number {
  switch (kind) {
    case "central_store":
      return 1;
    case "branch":
      return 2;
    case "xpress":
      return 4;
    case "kiosk":
      return 5;
    case "smartpoint":
      return 7;
    default:
      return 1;
  }
}
