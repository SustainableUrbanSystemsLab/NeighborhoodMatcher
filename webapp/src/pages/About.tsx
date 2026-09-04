import { Link } from "react-router";
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
            For each row in your target file, the tool finds the most similar
            row in the supplemental file, using the characteristics you
            choose and never ZIP code or any other identifier.
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
