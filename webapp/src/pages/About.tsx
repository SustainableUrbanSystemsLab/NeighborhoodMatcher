import { useEffect } from "react";
import { Link, useLocation } from "react-router";
import { ScenarioExplainer, type ScenarioData } from "@/components/ScenarioExplainer";
import { STEP_VISUALS } from "@/components/AlgorithmSteps";
import { DataChecklist } from "@/components/DataChecklist";
import {
  IconContribution,
  IconFeatures,
  IconFlags,
  IconMnn,
  IconNndr,
  IconSmd,
  IconTier,
  IconTies,
} from "@/components/SignalIcons";
import { SiteFooter } from "@/components/SiteFooter";
import { ThemeToggle } from "@/components/ThemeToggle";
import { MATCHER_VERSION, REPO_URL, SITE_URL } from "@/lib/about";
import { isDesktopApp } from "@/lib/platform";
import { useTheme } from "@/lib/use-theme";
import scenariosJson from "@/data/scenarios.json";

const SCENARIOS = scenariosJson as unknown as ScenarioData[];

const ALGORITHM_STEPS: Array<{ title: string; body: React.ReactNode }> = [
  {
    title: "Identify shared columns.",
    body: (
      <>
        Columns with the same name in both files are linked automatically;
        you can link the others by hand. A column can be left out of the
        matching (an ID column, for example) and still appear in the output.
      </>
    ),
  },
  {
    title: "Put every variable on the same scale.",
    body: (
      <>
        Each variable is converted to a z-score using the mean and standard
        deviation of both files together, so a variable with big numbers
        (rent in dollars) does not count more than one with small numbers
        (a percentage).
      </>
    ),
  },
  {
    title: "Measure similarity.",
    body: (
      <>
        For each target row, the tool computes the straight-line (Euclidean)
        distance to every supplemental row across all the variables. A small
        distance means the rows are alike (say 0.03); a large one means they
        differ (say 0.99).
      </>
    ),
  },
  {
    title: "Pick the best match.",
    body: (
      <>
        The closest row wins. If two rows tie exactly, the first one in file
        order is chosen, the same way every time, and the row is flagged.
      </>
    ),
  },
  {
    title: "Report quality signals.",
    body: (
      <>
        Confidence tier, NNDR, MNN, near misses, ties, per-feature
        contribution and SMD, all explained below.
      </>
    ),
  },
];

const LINK = "text-blue-600 dark:text-blue-400 underline hover:text-blue-800";

const SIGNALS: Array<{
  name: React.ReactNode;
  question: string;
  body: React.ReactNode;
  Icon: () => React.JSX.Element;
}> = [
  {
    name: "Confidence tier",
    question: "How much should you trust this match?",
    Icon: IconTier,
    body: (
      <>
        <strong>High</strong>: one row is clearly the closest, the pairing
        holds in both directions, and every variable was compared.{" "}
        <strong>Medium</strong>: a reasonable match, but other rows were
        nearly as close or some variables were missing.{" "}
        <strong>Low</strong>: an exact tie, a one-sided pairing, a ratio
        close to 1, or only one variable to go on.{" "}
        <strong>No match</strong>: nothing could be assigned.
      </>
    ),
  },
  {
    name: "NNDR and near-miss count",
    question: "How clearly did one row stand out?",
    Icon: IconNndr,
    body: (
      <>
        NNDR is the best distance divided by the second-best (
        <a href="https://doi.org/10.1023/B:VISI.0000029664.99615.94" target="_blank" rel="noreferrer" className={LINK}>Lowe 2004</a>
        ). Near 0 means one row stood out; near 1 means two rows were about
        as close. The near-miss count is how many other rows were almost as
        close as the winner.
      </>
    ),
  },
  {
    name: "Mutual Nearest Neighbor (MNN)",
    question: "Does the match hold in both directions?",
    Icon: IconMnn,
    body: (
      <>
        Confirmed means the supplemental row is also closest to this target.
        Not confirmed means it is actually closer to a different target row,
        so check the match before you use it (
        <a href="https://doi.org/10.5220/0001787803310340" target="_blank" rel="noreferrer" className={LINK}>Muja &amp; Lowe 2009</a>
        ).
      </>
    ),
  },
  {
    name: "Variables used",
    question: "How many variables went into the match?",
    Icon: IconFeatures,
    body: (
      <>
        Missing values are never compared; they add a fixed penalty instead.
        A match on 1 of 4 variables rests on much less than a match on 4 of
        4. The tool also tells you when the winner matches exactly on every
        variable that was available.
      </>
    ),
  },
  {
    name: (
      <>
        Ties (<code>repeats</code>)
      </>
    ),
    question: "Did several rows land at exactly the same distance?",
    Icon: IconTies,
    body: (
      <>
        <code>repeats</code> counts the rows at the minimum distance,
        including the winner (1 means no tie). The first row in file order is
        chosen, the same way every time, and the row is flagged.
      </>
    ),
  },
  {
    name: "Per-feature contribution",
    question: "Which variables made up the distance?",
    Icon: IconContribution,
    body: (
      <>
        For information only. If one column accounts for most of a{" "}
        <em>large</em> distance, check its units or scale. One column
        dominating a small distance is normal.
      </>
    ),
  },
  {
    name: "Standardized Mean Difference (SMD)",
    question: "Are the two datasets balanced overall?",
    Icon: IconSmd,
    body: (
      <>
        Below 0.10 is good, above 0.25 is poor (
        <a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC3472075/" target="_blank" rel="noreferrer" className={LINK}>Austin</a>
        ). This looks at the two datasets as a whole, not at any single
        match.
      </>
    ),
  },
  {
    name: "Plain-English flags",
    question: "Why was this row flagged?",
    Icon: IconFlags,
    body: (
      <>
        The specific reasons, written out in one line. The confidence tier
        is the short version.
      </>
    ),
  },
];

export default function About() {
  const theme = useTheme();
  // Client-side navigation does not scroll to a #fragment (the home page
  // links to #offline): do it once the section has rendered.
  const { hash } = useLocation();
  useEffect(() => {
    if (!hash) return;
    document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView();
  }, [hash]);
  return (
    <div className="min-h-screen bg-canvas">
      <div className="mx-auto max-w-4xl p-4">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">How it works</h1>
          <div className="flex items-center gap-3">
            <ThemeToggle theme={theme} />
            <Link to="/" className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800">
              ← Home
            </Link>
          </div>
        </div>

        <section className="mb-6 rounded-lg border border-gray-200 bg-surface p-5">
          <h2 className="mb-1 text-lg font-semibold text-gray-900">
            The matching algorithm
          </h2>
          <p className="mb-3 text-sm text-gray-500">
            For each row in your target file, the tool finds the most similar
            row in the supplemental file, using the characteristics you
            choose — never ZIP codes, census tract IDs or other geographic
            identifiers, which the tool refuses to use as matching variables.
          </p>
          <ol className="space-y-2">
            {ALGORITHM_STEPS.map((step, i) => {
              const Visual = STEP_VISUALS[i]!;
              return (
                <li key={step.title} className="flex items-center gap-4">
                  <div className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white">
                    {i + 1}
                  </div>
                  <div className="h-16 w-24 flex-none rounded border border-gray-100 bg-gray-50/60 p-1">
                    <Visual />
                  </div>
                  <p className="text-sm text-gray-700">
                    <strong>{step.title}</strong> {step.body}
                  </p>
                </li>
              );
            })}
          </ol>
        </section>

        <section className="mb-6 rounded-lg border border-gray-200 bg-surface p-5">
          <h2 className="mb-1 text-lg font-semibold text-gray-900">
            Preparing your data
          </h2>
          <p className="mb-3 text-sm text-gray-500">
            Standardization fixes <em>scale</em>, not <em>meaning</em>: the
            tool cannot tell that two columns with the same name were
            computed differently. That check is yours.
          </p>
          <DataChecklist />
        </section>

        <section
          id="offline"
          className="mb-6 scroll-mt-4 rounded-lg border border-gray-200 bg-surface p-5"
        >
          <h2 className="mb-1 text-lg font-semibold text-gray-900">
            Use it without Internet
          </h2>
          <p className="mb-3 text-sm text-gray-500">
            Nothing here needs a connection except the first visit: the
            Python runtime, the matching engine and every asset are served by
            this site itself and cached in your browser. Three ways to run the
            tool where there is no Internet at all:
          </p>
          <div className="grid gap-3 text-sm text-gray-700 sm:grid-cols-3">
            <div className="rounded-lg border border-gray-200 p-3">
              <h3 className="font-semibold text-gray-900">Keep this site offline</h3>
              <p className="mt-1 text-xs leading-relaxed text-gray-600">
                After one visit this device keeps working without a
                connection — the footer says{" "}
                <em>Available offline on this device</em> once everything is
                cached. To get an app icon, use your browser&apos;s{" "}
                <em>Install</em> option (address-bar icon or browser menu).
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 p-3">
              <h3 className="font-semibold text-gray-900">Desktop app</h3>
              <p className="mt-1 text-xs leading-relaxed text-gray-600">
                For a computer that never goes online (a secure enclave or
                VDI). Same engine, everything included, no download at run
                time.
              </p>
              <ul className="mt-2 space-y-1 text-xs">
                <li>
                  <a href={`${REPO_URL}/releases/latest/download/NeighborhoodMatcher-darwin-aarch64.dmg`} className={LINK}>
                    macOS (Apple Silicon) .dmg
                  </a>
                </li>
                <li>
                  <a href={`${REPO_URL}/releases/latest/download/NeighborhoodMatcher-windows-x64-setup.exe`} className={LINK}>
                    Windows (x64) installer
                  </a>
                  <span className="text-gray-500"> — WebView2 runtime included (~220 MB)</span>
                </li>
                <li>
                  <a href={`${REPO_URL}/releases/latest`} target="_blank" rel="noreferrer" className={LINK}>
                    All releases
                  </a>
                </li>
              </ul>
              <p className="mt-2 text-[11px] leading-relaxed text-gray-500">
                The apps carry no developer certificate yet. macOS blocks
                the first launch: click <em>Done</em>, open <em>System
                Settings</em> → <em>Privacy &amp; Security</em> and click{" "}
                <em>Open Anyway</em>. Or install from Terminal, with no
                prompt at all:
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-gray-700">
                <code className="break-all">curl -fsSL {REPO_URL}/releases/latest/download/install-macos.sh | sh</code>
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
                Windows SmartScreen: <em>More info</em>, then <em>Run
                anyway</em>. Your IT department may need to approve the
                installer first.
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 p-3">
              <h3 className="font-semibold text-gray-900">Host it yourself</h3>
              <p className="mt-1 text-xs leading-relaxed text-gray-600">
                A zip of this exact build for an institution&apos;s own web
                server or intranet — a static folder with no external
                dependencies. The included HOSTING.txt lists the two server
                settings that matter (index.html fallback, .wasm content
                type).
              </p>
              <p className="mt-2 text-xs">
                {/* The desktop app does not embed the zip: link the website's copy. */}
                <a
                  href={`${isDesktopApp() ? SITE_URL : "/"}offline/nbhdmatch-site-v${MATCHER_VERSION}.zip`}
                  className={LINK}
                >
                  Download the site (v{MATCHER_VERSION}, ~11 MB)
                </a>
              </p>
            </div>
          </div>
        </section>

        <details className="group mb-6 rounded-lg border border-gray-200 bg-surface">
          <summary className="flex cursor-pointer items-center gap-3 p-5 [&::-webkit-details-marker]:hidden">
            <span className="text-gray-400 transition-transform group-open:rotate-90">
              ▸
            </span>
            <span>
              <span className="block text-lg font-semibold text-gray-900">
                Quality signals
              </span>
              <span className="block text-xs text-gray-500">
                Start with the confidence tier and the flags. Then look at
                NNDR, MNN and near misses. Contribution tells you <em>why</em>;
                SMD tells you about the run as a whole.
              </span>
            </span>
          </summary>
          <dl className="grid gap-x-6 gap-y-3 px-5 pb-5 text-sm text-gray-700 sm:grid-cols-2">
            {SIGNALS.map((s, i) => (
              <div key={i} className="flex gap-3">
                <div className="h-12 w-12 flex-none rounded border border-gray-100 bg-gray-50/60 p-1">
                  <s.Icon />
                </div>
                <div>
                  <dt className="font-semibold text-gray-900">{s.name}</dt>
                  <dd className="mt-0.5">
                    <span className="text-gray-500">{s.question}</span> {s.body}
                  </dd>
                </div>
              </div>
            ))}
          </dl>
        </details>

        <details className="group mb-4 rounded-lg border border-gray-200 bg-surface">
          <summary className="flex cursor-pointer items-center gap-3 p-5 [&::-webkit-details-marker]:hidden">
            <span className="text-gray-400 transition-transform group-open:rotate-90">
              ▸
            </span>
            <span>
              <span className="block text-lg font-semibold text-gray-900">
                Scenarios
              </span>
              <span className="block text-xs text-gray-500">
                Five small example datasets: an exact match, rounding, a
                scale mismatch, an ambiguous match, and MNN not confirmed.
                Each shows the matcher&apos;s real numbers and the
                corresponding math.
              </span>
            </span>
          </summary>
          <div className="space-y-4 px-5 pb-5">
            {SCENARIOS.map((s, i) => (
              <ScenarioExplainer key={s.scenario_label} scenario={s} index={i} />
            ))}
          </div>
        </details>

        <SiteFooter />
      </div>
    </div>
  );
}
