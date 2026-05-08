import { Link } from "react-router";

interface Scenario {
  label: string;
  title: string;
  summary: string;
  takeaway: string;
  slug: string;
}

const SCENARIOS: Scenario[] = [
  {
    label: "Scenario 1",
    title: "Exact Match",
    summary:
      "The target row appears verbatim in the supplemental dataset. Distance = 0, NNDR = 0, MNN confirmed, no flags.",
    takeaway:
      "Baseline: shows what a perfect match looks like across every signal.",
    slug: "exact_match",
  },
  {
    label: "Scenario 2",
    title: "Rounding Discrepancy",
    summary:
      "Target values are rounded to coarser precision than the supplemental. The correct row is still selected, but with non-zero distance.",
    takeaway:
      "Small, evenly-spread contributions across features indicate noise from unit conversion rather than a structural mismatch.",
    slug: "rounding_discrepancy",
  },
  {
    label: "Scenario 3",
    title: "Scale Mismatch",
    summary:
      "One feature is reported in different units (e.g. thousands vs. raw counts). That single feature dominates the distance.",
    takeaway:
      "A contribution bar overwhelmingly driven by one column is the signal to investigate unit alignment.",
    slug: "scale_mismatch",
  },
  {
    label: "Scenario 4",
    title: "Ambiguous Match",
    summary:
      "Two supplemental rows sit at nearly identical distances from the target. NNDR approaches 1.0, triggering the near-miss flag.",
    takeaway:
      "A high NNDR with multiple near-misses means the match was not clearly determined — treat the link with caution.",
    slug: "ambiguous_match",
  },
  {
    label: "Scenario 5",
    title: "MNN Not Confirmed",
    summary:
      "The forward match picks supplemental row X, but X's closest target is a different row. Mutual Nearest Neighbor check fails.",
    takeaway:
      "Asymmetric neighbours are a sign the supplemental row may be a better fit for another target — this record may have no valid supplemental match.",
    slug: "mnn_not_confirmed",
  },
];

function PdfFrame({ slug, suffix, label }: { slug: string; suffix: string; label: string }) {
  return (
    <figure className="overflow-hidden rounded-lg border border-gray-200">
      <figcaption className="border-b border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-700">
        {label}
      </figcaption>
      <object
        data={`${import.meta.env.BASE_URL}explanatory/${slug}${suffix}.pdf`}
        type="application/pdf"
        className="h-96 w-full"
      >
        <a
          href={`${import.meta.env.BASE_URL}explanatory/${slug}${suffix}.pdf`}
          className="text-sm text-blue-600"
        >
          Open {slug}{suffix}.pdf
        </a>
      </object>
    </figure>
  );
}

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
            Each scenario below is a small, curated dataset that demonstrates
            one characteristic situation. The scatter chart shows the target
            against the supplemental pool; the histogram shows the full
            distance distribution.
          </p>

          <div className="space-y-8">
            {SCENARIOS.map((s) => (
              <article
                key={s.slug}
                className="rounded-lg border border-gray-200 bg-white p-5"
              >
                <div className="mb-3">
                  <p className="text-xs uppercase tracking-wider text-blue-600">
                    {s.label}
                  </p>
                  <h3 className="text-base font-semibold text-gray-900">
                    {s.title}
                  </h3>
                  <p className="mt-1 text-sm text-gray-700">{s.summary}</p>
                  <p className="mt-2 rounded bg-blue-50 px-3 py-2 text-xs text-blue-900">
                    <strong>Reading the signal:</strong> {s.takeaway}
                  </p>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <PdfFrame slug={s.slug} suffix="" label="Scatter view" />
                  <PdfFrame slug={s.slug} suffix="_hist" label="Distance histogram" />
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
