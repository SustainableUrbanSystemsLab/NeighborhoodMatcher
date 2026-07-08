// HIPAA NOTE: No dataset contents should be logged or persisted.
// All computation runs client-side via a Pyodide-powered Web Worker —
// data never leaves the browser.

import type { ColumnLink } from "@/types";

export {
  runMatching,
  prefetchPyodide,
  poolSizeFor,
  type PyodideStatus,
} from "./pyodide-runtime";

// Mirrors matcher.align.find_common_headers: names are compared with
// whitespace stripped; empty names (trailing-comma artifact) never link;
// a name that appears more than once in either file is ambiguous and is
// not auto-linked (the Python side hard-rejects such links — surface them
// via findAmbiguousHeaders instead of guessing).
export function findCommonHeaders(
  headers1: string[],
  headers2: string[]
): ColumnLink[] {
  const ambiguous = findAmbiguousHeaders(headers1, headers2);
  const names1 = headers1.map((h) => h.trim());
  const names2 = headers2.map((h) => h.trim());

  const h2Lookup = new Map<string, number>();
  names2.forEach((name, idx) => {
    if (name) h2Lookup.set(name, idx);
  });

  const links: ColumnLink[] = [];
  names1.forEach((name, idx) => {
    if (!name || ambiguous.includes(name)) return;
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

// Shared column names that appear more than once in either file. Matching
// on them would silently link the wrong data (last-wins) or double-weight
// a column; callers should show these to the user instead of linking them.
export function findAmbiguousHeaders(
  headers1: string[],
  headers2: string[]
): string[] {
  const names1 = headers1.map((h) => h.trim()).filter(Boolean);
  const names2 = headers2.map((h) => h.trim()).filter(Boolean);
  const dupes = (names: string[]) => {
    const seen = new Set<string>();
    const out = new Set<string>();
    for (const n of names) {
      if (seen.has(n)) out.add(n);
      seen.add(n);
    }
    return out;
  };
  const shared = new Set(names1.filter((n) => names2.includes(n)));
  const all = new Set([...dupes(names1), ...dupes(names2)]);
  return [...all].filter((n) => shared.has(n)).sort();
}
