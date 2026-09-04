import { Link } from "react-router";
import { ScenarioExplainer, type ScenarioData } from "@/components/ScenarioExplainer";
import { STEP_VISUALS } from "@/components/AlgorithmSteps";
import { DataChecklist } from "@/components/DataChecklist";
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
        Same-named columns link automatically; link others by hand. A column
        can be excluded from matching (an ID, say) and still stay in the
        output.
      </>
    ),
  },
  {
    title: "Standardize jointly.",
    body: (
      <>
        Every variable is put on one z-score scale, with the mean and SD
        pooled across both files, so large numbers don&apos;t dominate.
      </>
    ),
  },
  {
    title: "Measure similarity.",
    body: (
      <>
        Each target row&apos;s Euclidean distance to every supplemental row:
        small means alike (0.03), large means different (0.99).
      </>
    ),
  },
  {
    title: "Pick the best match.",
    body: (
      <>
        The closest row wins. Exact ties go to the first in file order —
        deterministically — and are flagged.
      </>
    ),
  },
  {
    title: "Derive quality signals.",
    body: (
      <>
        Confidence tier, NNDR, MNN, near misses, ties, per-feature
        contribution and SMD — defined below.
      </>
    ),
  },
];

const LINK = "text-blue-600 dark:text-blue-400 underline hover:text-blue-800";

const SIGNALS: Array<{ name: React.ReactNode; question: string; body: React.ReactNode }> = [
  {
    name: "Confidence tier",
    question: "How much should you trust this row's match?",
    body: (
      <>
        <strong>High</strong>: one clearly closest row, confirmed both ways,
        all variables compared. <strong>Medium</strong>: plausible, but close
        competitors or missing variables. <strong>Low</strong>: an exact tie,
        a one-sided pairing, a near-ambiguous ratio, or only one variable.{" "}
        <strong>No match</strong>: nothing could be assigned.
      </>
    ),
  },
  {
    name: "NNDR + near-miss count",
    question: "How clearly was one row the best?",
    body: (
      <>
        d₁/d₂ (
        <a href="https://doi.org/10.1023/B:VISI.0000029664.99615.94" target="_blank" rel="noreferrer" className={LINK}>Lowe 2004</a>
        ): near 0 is clear, near 1 is ambiguous. Near misses = rows within
        the threshold of the best.
      </>
    ),
  },
  {
    name: "Mutual Nearest Neighbor (MNN)",
    question: "Does the match hold in both directions?",
    body: (
      <>
        Not confirmed means the supplemental row is closer to a different
        target — review before use (
        <a href="https://doi.org/10.5220/0001787803310340" target="_blank" rel="noreferrer" className={LINK}>Muja &amp; Lowe 2009</a>
        ).
      </>
    ),
  },
  {
    name: "Features used",
    question: "How many variables informed the match?",
    body: (
      <>
        Missing values never compare — they add a fixed penalty — so 1 of 4
        rests on far less than 4 of 4. Also reported: exact on every
        available variable.
      </>
    ),
  },
  {
    name: (
      <>
        Ties (<code>repeats</code>)
      </>
    ),
    question: "Several rows at exactly the same minimum distance?",
    body: (
      <>
        <code>repeats</code> counts them including the winner (1 = unique).
        First in file order is chosen, deterministically, and the row is
        flagged.
      </>
    ),
  },
  {
    name: "Per-feature contribution",
    question: "Which variables drove the distance?",
    body: (
      <>
        Diagnostic only. 80% from one column <em>and</em> a large distance
        suggests a unit or scale problem; concentration alone is normal.
      </>
    ),
  },
  {
    name: "Standardized Mean Difference (SMD)",
    question: "Is the whole run balanced?",
    body: (
      <>
        |SMD| &lt; 0.10 good, &gt; 0.25 poor (
        <a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC3472075/" target="_blank" rel="noreferrer" className={LINK}>Austin</a>
        ). A dataset-level check, not a verdict on any one match.
      </>
    ),
  },
  {
    name: "Plain-English flags",
    question: "Why exactly was this row flagged?",
    body: <>The specific reasons in one string; the tier summarizes them.</>,
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

        <section className="mb-6 rounded-lg border border-gray-200 bg-surface p-5">
          <h2 className="mb-1 text-lg font-semibold text-gray-900">
            The matching algorithm
          </h2>
          <p className="mb-3 text-sm text-gray-500">
            For each row in your target file, the most similar row in the
            supplemental file — by the characteristics you choose, never by
            ZIP code or any identifier.
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
            Standardization corrects <em>scale</em>, never <em>meaning</em>:
            the tool cannot tell that two same-named columns were computed
            differently. That check is yours.
          </p>
          <DataChecklist />
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
                Start with the confidence tier and the flags; then NNDR, MNN
                and near misses. Contribution explains <em>why</em>; SMD
                judges the whole run.
              </span>
            </span>
          </summary>
          <dl className="grid gap-x-6 gap-y-3 px-5 pb-5 text-sm text-gray-700 sm:grid-cols-2">
            {SIGNALS.map((s, i) => (
              <div key={i}>
                <dt className="font-semibold text-gray-900">{s.name}</dt>
                <dd className="mt-0.5">
                  <span className="text-gray-500">{s.question}</span> {s.body}
                </dd>
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
                Five small datasets — an exact match, rounding, a scale
                mismatch, an ambiguous match, MNN not confirmed — with the
                matcher&apos;s real numbers and the worked math.
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
