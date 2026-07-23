/**
 * String loader — returns the active locale's string set.
 *
 * Today this is hardwired to Greek (el). When multi-language support is
 * needed:
 *   1. Add a new file (e.g. `en.ts`) with the same shape.
 *   2. Read the active locale from cookies / env / headers.
 *   3. Return the matching set.
 *
 * The `Strings` type is exported for components that want typed access.
 */

import el, { type Strings } from "./el";

export type { Strings };

export function getStrings(): Strings {
  return el;
}

export const strings = el;
