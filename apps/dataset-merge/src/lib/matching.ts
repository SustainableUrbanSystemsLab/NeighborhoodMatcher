// HIPAA NOTE: No dataset contents should be logged or persisted.
// All computation runs client-side via a Pyodide-powered Web Worker —
// data never leaves the browser.

import type { ColumnLink } from "@/types";

export {
  runMatching,
  prefetchPyodide,
  type PyodideStatus,
} from "./pyodide-runtime";

export function findCommonHeaders(
  headers1: string[],
  headers2: string[]
): ColumnLink[] {
  const h2Lookup = new Map<string, number>();
  headers2.forEach((name, idx) => h2Lookup.set(name, idx));

  const links: ColumnLink[] = [];
  headers1.forEach((name, idx) => {
    const h2Idx = h2Lookup.get(name);
    if (h2Idx !== undefined) {
      links.push({
        headerName: name,
        targetIndex: idx,
        supplementalIndex: h2Idx,
        excluded: false,
      });
    }
  });
  return links;
}
