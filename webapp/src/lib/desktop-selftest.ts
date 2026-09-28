// Desktop smoke test. Runs only inside the desktop app, and only when it was
// started with NBHDMATCH_SELFTEST=<report file> (the Rust `selftest_mode`
// command says so) — CI does that on real macOS (WKWebView) and Windows
// (WebView2) runners after building the installers.
//
// It drives the same code paths a researcher uses, inside the real webview:
// CSV parsing, the identifier guard, the Pyodide worker pool loading the
// runtime and the engine from the app bundle, the results package, and
// saving it through `save_download`. It also checks that the window cannot
// reach the network. The verdict goes back to Rust (`selftest_report`),
// which writes PASS/FAIL to the report file and exits the app.

import { invoke } from "@tauri-apps/api/core";
import { parseCSVFile } from "@/lib/csv";
import { columnVerdicts, guardLinks } from "@/lib/identifier-guard";
import { findCommonHeaders, runMatching } from "@/lib/matching";
import { saveFile } from "@/lib/platform";
import { buildResultsZip } from "@/lib/zip-builder";

function sampleCsvs(): { target: string; supplemental: string } {
  let target = "pid,census tract,pct_poverty,median_income\n";
  let supplemental = "census tract,pct_poverty,median_income,walkability\n";
  for (let i = 0; i < 30; i++) {
    target += `p${i},${13089020100 + i * 100},${(5 + i * 0.7).toFixed(1)},${40000 + i * 900}\n`;
  }
  for (let j = 0; j < 40; j++) {
    supplemental += `${13089020100 + j * 100},${(5 + j * 0.7).toFixed(1)},${40000 + j * 900},${(3 + j * 0.1).toFixed(1)}\n`;
  }
  return { target, supplemental };
}

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

export async function runSelftestIfRequested(): Promise<void> {
  let enabled = false;
  try {
    enabled = await invoke<boolean>("selftest_mode");
  } catch {
    return;
  }
  if (!enabled) return;

  const started = performance.now();
  try {
    const csv = sampleCsvs();
    const [target, supplemental] = await Promise.all([
      parseCSVFile(new File([csv.target], "selftest_target.csv", { type: "text/csv" })),
      parseCSVFile(new File([csv.supplemental], "selftest_tracts.csv", { type: "text/csv" })),
    ]);

    const links = guardLinks(
      findCommonHeaders(target.headers, supplemental.headers),
      target,
      supplemental,
      columnVerdicts(target),
      columnVerdicts(supplemental)
    );
    const active = links.filter((l) => !l.excluded).map((l) => l.headerName);
    const blocked = links.flatMap((l) => (l.blocked ? [l.blocked] : []));
    check(
      blocked.length === 1 && blocked[0]!.column === "census tract",
      `identifier guard: expected 'census tract' blocked, got ${JSON.stringify(blocked)}`
    );
    check(
      active.join(",") === "pct_poverty,median_income",
      `identifier guard: unexpected matching variables ${active.join(", ")}`
    );

    const { output } = await runMatching(target, supplemental, links, 0.8, null, null);
    check(output.summary.total === 30, `expected 30 matched rows, got ${output.summary.total}`);
    check(
      output.feature_names.join(",") === "pct_poverty,median_income",
      `engine matched on ${output.feature_names.join(", ")}`
    );
    check(
      output.linked_headers.includes("census tract"),
      "the blocked column did not pass through to the linked output"
    );

    const blob = await buildResultsZip(
      output,
      target,
      supplemental,
      links.filter((l) => !l.excluded),
      null,
      new Date(),
      blocked
    );
    const savedTo = await saveFile(blob, "selftest-results.zip");
    check(!!savedTo, "save_download returned no path");

    // The CSP must keep the window off the network.
    let reachedNetwork = true;
    try {
      await fetch("https://example.com/", { mode: "no-cors" });
    } catch {
      reachedNetwork = false;
    }
    check(!reachedNetwork, "a request to https://example.com/ was not blocked");

    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    await invoke("selftest_report", {
      ok: true,
      detail: `matched ${output.summary.total} rows on ${active.join(", ")} in ${seconds}s; blocked ${blocked[0]!.column}; saved ${savedTo}; network blocked`,
    });
  } catch (err) {
    const detail = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);
    await invoke("selftest_report", { ok: false, detail });
  }
}
