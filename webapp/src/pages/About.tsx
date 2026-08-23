import { Link } from "react-router";
import { ScenarioExplainer, type ScenarioData } from "@/components/ScenarioExplainer";
import { STEP_VISUALS } from "@/components/AlgorithmSteps";
import { SiteFooter } from "@/components/SiteFooter";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useTheme } from "@/lib/use-theme";
import scenariosJson from "@/data/scenarios.json";

const SCENARIOS = scenariosJson as unknown as ScenarioData[];

const ALGORITHM_STEPS: Array<{ title: string; body: React.ReactNode }> = [
  {
    title: "Identify shared columns.",
    body: (
      <>
        Columns with exactly matching names are detected automatically;
        columns whose names differ can be linked manually on the matching
        page. A column can also be excluded from matching without un-linking
        it — for example, an ID column that appears in both files but is not
        a real geographic characteristic, or a variable you know is measured
        on incompatible scales. Excluded columns stay in the output but are
        not used to find the match.
      </>
    ),
  },
  {
    title: "Standardize jointly.",
    body: (
      <>
        Different variables live on different scales — population counts in
        the tens of thousands, percentages under 100. Each variable is
        converted to a standardized scale (z-scores) so variables with larger
        numbers don&apos;t automatically dominate the match. The mean and
        standard deviation are computed across both datasets together, so the
        same value means the same thing in each.
      </>
    ),
  },
  {
    title: "Measure similarity.",
    body: (
      <>
        For every target row, the tool measures how similar it is to each
        supplemental row across the standardized characteristics (Euclidean
        distance: square each difference, add them up, take the square root).
        Similar rows get small distances (e.g., 0.03); substantially different
        rows get large ones (e.g., 0.99). All distances are kept so quality
        signals can be derived.
      </>
    ),
  },
  {
    title: "Pick the best match per target.",
    body: (
      <>
        The closest supplemental row by standardized Euclidean distance is
        chosen. When several rows are exactly tied at the minimum, the first
        in file order wins (deterministic, not random) and the tie is
        recorded in the <code>repeats</code> column.
      </>
    ),
  },
  {
    title: "Derive quality signals and flags.",
    body: <>See below.</>,
  },
];

export default function About() {
  const theme = useTheme();
  return (
    <div className="min-h-screen bg-gray-50">
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

        <section className="mb-8 rounded-lg border border-gray-200 bg-surface p-5">
          <h2 className="mb-2 text-lg font-semibold text-gray-900">
            The matching algorithm
          </h2>
          <ol className="space-y-3">
            {ALGORITHM_STEPS.map((step, i) => {
              const Visual = STEP_VISUALS[i]!;
              return (
                <li key={step.title} className="flex items-center gap-4">
                  <div className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white">
                    {i + 1}
                  </div>
                  <div className="h-20 w-28 flex-none rounded border border-gray-100 bg-gray-50/60 p-1">
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

        <section className="mb-8 rounded-lg border border-gray-200 bg-surface p-5">
          <h2 className="mb-2 text-lg font-semibold text-gray-900">
            Preparing your data
          </h2>
          <p className="mb-3 text-sm text-gray-700">
            Standardization corrects for <em>scale</em> (dollars vs thousands
            of dollars), never for <em>meaning</em>. The tool cannot tell that
            two same-named columns were computed differently — that check is
            yours to make before uploading.
          </p>
          <ul className="list-disc space-y-2 pl-5 text-sm text-gray-700">
            <li>
              <strong>Same definition and coding in both files.</strong> A
              poverty rate computed against 100% of the federal poverty line
              in one file and 180% in the other shifts every value
              systematically: matches still get made, but they quietly get
              worse. The results page reports a per-variable{" "}
              <em>offset SMD</em> check that flags this pattern after a run.
            </li>
            <li>
              <strong>Raw values only.</strong> Never mix an
              already-standardized (z-scored) column with raw data — pooled
              statistics collapse the narrow side onto a point. Wildly
              different spreads trigger a scale warning, but a same-scale
              definition difference does not.
            </li>
            <li>
              <strong>Mark missing data as missing.</strong> Blank, NA, N/A,
              null, none, -, ., NaN, and #N/A are recognized as missing.
              Convert sentinel codes like 9999 or -99 to blanks first; left
              in place they count as real extreme values.
            </li>
            <li>
              <strong>More variables is not automatically better.</strong>{" "}
              Missing values are never imputed — each missing dimension adds a
              fixed distance penalty instead, so a mostly-missing variable
              contributes mostly noise and can degrade every match. After a
              run, the variable check on the results page re-matches with each
              variable left out and recommends excluding any that hurt the
              linkage.
            </li>
          </ul>
        </section>

        <details open className="group mb-8 rounded-lg border border-gray-200 bg-surface">
          <summary className="flex cursor-pointer items-center gap-3 p-5 [&::-webkit-details-marker]:hidden">
            <span className="text-gray-400 transition-transform group-open:rotate-90">
              ▸
            </span>
            <span>
              <span className="block text-lg font-semibold text-gray-900">
                Quality signals
              </span>
              <span className="block text-xs text-gray-500">
                What the confidence tier, NNDR, MNN, per-feature contribution,
                SMD, and the flags column mean
              </span>
            </span>
          </summary>
          <div className="px-5 pb-5">
            <p className="mb-4 rounded border border-blue-100 bg-blue-50 p-3 text-sm text-gray-700">
              <strong>How the signals fit together:</strong> for a single
              match, start with the confidence tier and the flags, then look
              at NNDR, MNN, and the near-miss count. Per-feature contribution
              helps explain <em>why</em> a match looks questionable — it is a
              diagnostic, not a verdict. SMD is a dataset-level check of the
              whole run, not a measure of whether any one match is correct.
            </p>
            <dl className="space-y-4 text-sm text-gray-700">
              <div>
                <dt className="font-semibold text-gray-900">Confidence tier</dt>
                <dd className="mt-1">
                  <span className="text-gray-500">
                    One plain verdict per row: how much should you trust this
                    match?
                  </span>{" "}
                  High = one row is clearly closest, confirmed in both
                  directions, all matching variables compared. Medium = the
                  match is plausible but something reduces certainty (close
                  competitors, or missing variables). Low = a concrete reason
                  to doubt it (an exact tie, a one-sided pairing, a
                  near-ambiguous ratio, or only one variable available). No
                  match = nothing could be assigned. The drill-down explains
                  each row&apos;s tier in a sentence.
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-gray-900">
                  Cascading NNDR + near-miss count
                </dt>
                <dd className="mt-1">
                  <span className="text-gray-500">
                    How clearly was one supplemental row the best match? Lower
                    NNDR = clearer; fewer near misses = clearer.
                  </span>{" "}
                  The Nearest Neighbor Distance Ratio (d₁/d₂,{" "}
                  <a href="https://doi.org/10.1023/B:VISI.0000029664.99615.94" target="_blank" rel="noreferrer" className="text-blue-600 dark:text-blue-400 underline hover:text-blue-800">Lowe 2004</a>)
                  measures how much better the best match is than the
                  second-best. Values near 0 = confident; values near 1 =
                  ambiguous. The cascading extension counts how many
                  supplemental rows sit within the user-configurable threshold
                  of the best match — that&apos;s the near-miss count.
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-gray-900">
                  Mutual Nearest Neighbor (MNN) confirmation
                </dt>
                <dd className="mt-1">
                  <span className="text-gray-500">
                    Does the match hold in both directions? (Confirmed / Not
                    confirmed.)
                  </span>{" "}
                  After picking the best supplemental row for a target, we run
                  the search in reverse: is the target also the closest target
                  of that supplemental row? If not, the pairing is one-sided —
                  the supplemental row is even closer to a different target —
                  and the match deserves review before use
                  (<a href="https://doi.org/10.5220/0001787803310340" target="_blank" rel="noreferrer" className="text-blue-600 dark:text-blue-400 underline hover:text-blue-800">Muja &amp; Lowe 2009</a>).
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-gray-900">Features used</dt>
                <dd className="mt-1">
                  <span className="text-gray-500">
                    How many matching variables actually informed this match?
                  </span>{" "}
                  Counts the variables observed on <em>both</em> sides of the
                  matched pair. Missing variables never contribute a real
                  comparison — they add a fixed penalty to the distance
                  instead — so a match that used 1 of 4 variables rests on far
                  less information than one that used all 4. The results view
                  also reports whether the pair agrees exactly on every
                  variable that was available.
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-gray-900">
                  Ties (<code>repeats</code>)
                </dt>
                <dd className="mt-1">
                  <span className="text-gray-500">
                    Did several supplemental rows sit at exactly the same
                    minimum distance?
                  </span>{" "}
                  The <code>repeats</code> column counts the rows sharing the
                  minimum <em>including the match itself</em>, so 1 means a
                  unique winner and 2+ means a genuine tie. When rows tie, the
                  first in file order is chosen — deterministically, not
                  randomly — and the row is flagged for review.
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-gray-900">
                  Per-feature contribution
                </dt>
                <dd className="mt-1">
                  <span className="text-gray-500">
                    Which variables drove the distance? Primarily a diagnostic
                    tool.
                  </span>{" "}
                  Breaks the squared distance into a proportion per feature.
                  If 80% of the distance comes from one column <em>and</em>{" "}
                  the distance itself is large, that suggests a scale or unit
                  issue in that column. Concentration alone is not a warning —
                  when only one variable differs, it will naturally carry
                  ~100% of a small distance.
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-gray-900">
                  Standardized Mean Difference (SMD)
                </dt>
                <dd className="mt-1">
                  <span className="text-gray-500">
                    Does the matching work well across the dataset as a whole?
                  </span>{" "}
                  A dataset-level balance check: for each feature, how
                  different are the means of the target and the
                  matched-supplemental subset? |SMD| &lt; 0.10 indicates good
                  balance; larger values indicate increasing differences
                  between the two groups (&gt; 0.25 is poor;{" "}
                  <a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC3472075/" target="_blank" rel="noreferrer" className="text-blue-600 dark:text-blue-400 underline hover:text-blue-800">Austin, PMC3472075</a>).
                  It is not a verdict on any individual match.
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-gray-900">Plain-English flags</dt>
                <dd className="mt-1">
                  <span className="text-gray-500">
                    The specific reasons a row was flagged, in one string.
                  </span>{" "}
                  For each matched row we assemble a human-readable flag string
                  combining the signals above. Empty = no concerns; otherwise
                  issues are listed with the specific features or thresholds
                  involved. The confidence tier summarizes them into one
                  verdict.
                </dd>
              </div>
            </dl>
          </div>
        </details>

        <section className="mb-4">
          <h2 className="mb-3 text-lg font-semibold text-gray-900">
            Worked scenarios
          </h2>
          <p className="mb-4 text-sm text-gray-600">
            Each scenario is a small, curated dataset (one target row, twenty
            supplemental rows) that demonstrates one characteristic situation.
            The numbers shown are the matcher&apos;s real outputs on that
            data — expand the sections inside each card for the full tables
            and the worked math.
          </p>

          <div className="space-y-8">
            {SCENARIOS.map((s, i) => (
              <ScenarioExplainer key={s.scenario_label} scenario={s} index={i} />
            ))}
          </div>
        </section>

        <SiteFooter />
      </div>
    </div>
  );
}
