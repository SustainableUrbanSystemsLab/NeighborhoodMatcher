import { Link } from "react-router";
import { ScenarioExplainer, type ScenarioData } from "@/components/ScenarioExplainer";
import scenariosJson from "@/data/scenarios.json";

const SCENARIOS = scenariosJson as unknown as ScenarioData[];

export default function About() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-4xl p-4">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">How it works</h1>
          <Link to="/" className="text-sm text-blue-600 hover:text-blue-800">
            ← Home
          </Link>
        </div>

        <section className="mb-8 rounded-lg border border-gray-200 bg-white p-5">
          <h2 className="mb-2 text-lg font-semibold text-gray-900">
            The matching algorithm
          </h2>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-gray-700">
            <li>
              <strong>Align shared columns.</strong> Exact name matches are
              detected automatically; mismatched names can be linked manually on
              the matching page. Columns can be excluded without un-linking
              them.
            </li>
            <li>
              <strong>Standardize jointly.</strong> Both datasets are z-score
              normalized using combined per-column mean and standard deviation,
              so the same raw value maps to the same standardized value in each.
            </li>
            <li>
              <strong>Compute distances.</strong> For every target row,
              Euclidean distance is computed against every supplemental row.
              Distances are kept in full so quality signals can be derived.
            </li>
            <li>
              <strong>Pick the best match per target.</strong> The closest
              supplemental row by standardized Euclidean distance is chosen.
              Ties are recorded in the <code>repeats</code> column.
            </li>
            <li>
              <strong>Derive quality signals and flags.</strong> See below.
            </li>
          </ol>
        </section>

        <section className="mb-8 rounded-lg border border-gray-200 bg-white p-5">
          <h2 className="mb-3 text-lg font-semibold text-gray-900">
            Quality signals
          </h2>
          <dl className="space-y-4 text-sm text-gray-700">
            <div>
              <dt className="font-semibold text-gray-900">
                Cascading NNDR + near-miss count
              </dt>
              <dd className="mt-1">
                The Nearest Neighbor Distance Ratio (d₁/d₂, Lowe 2004)
                measures how much better the best match is than the second-best.
                Values near 0 = confident; values near 1 = ambiguous. The
                cascading extension counts how many supplemental rows sit within
                the user-configurable threshold of the best match — that's the
                near-miss count.
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-gray-900">
                Mutual Nearest Neighbor (MNN) confirmation
              </dt>
              <dd className="mt-1">
                After picking the best supplemental row for a target, we run
                the search in reverse: is the target the closest target of that
                supplemental row? If not, the pairing is asymmetric and likely
                belongs to another record (Muja & Lowe 2009).
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-gray-900">
                Per-feature contribution
              </dt>
              <dd className="mt-1">
                Breaks the squared distance into a proportion per feature.
                If 80% of the distance comes from one column, that's a strong
                signal of a scale or unit issue rather than broad mismatch.
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-gray-900">
                Standardized Mean Difference (SMD)
              </dt>
              <dd className="mt-1">
                A dataset-level balance check: for each feature, how different
                are the means of the target and the matched-supplemental
                subset? |SMD| &gt; 0.10 indicates imbalance; &gt; 0.25 is poor
                (Austin, PMC3472075).
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-gray-900">Plain-English flags</dt>
              <dd className="mt-1">
                For each matched row we assemble a human-readable flag string
                combining the signals above. Empty = no concerns; otherwise
                issues are listed with the specific features or thresholds
                involved.
              </dd>
            </div>
          </dl>
        </section>

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
      </div>
    </div>
  );
}
