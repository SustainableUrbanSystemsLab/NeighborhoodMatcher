import { Link, useNavigate } from "react-router";

export default function Home() {
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-xl text-center">
        <img
          src="/logo.svg"
          alt=""
          className="mx-auto mb-4 h-16 w-16"
        />
        <h1 className="mb-2 text-4xl font-bold text-gray-900">
          Dataset Matcher
        </h1>
        <p className="mb-8 text-lg text-gray-500">
          Match and merge two CSV datasets using statistical similarity
        </p>

        <div className="mb-8 space-y-3 text-left">
          <div className="rounded-lg bg-white p-4 shadow-sm">
            <h3 className="font-medium text-gray-900">1. Upload two datasets</h3>
            <p className="text-sm text-gray-500">
              A target dataset and a supplemental dataset in CSV format
            </p>
          </div>
          <div className="rounded-lg bg-white p-4 shadow-sm">
            <h3 className="font-medium text-gray-900">2. Link matching columns</h3>
            <p className="text-sm text-gray-500">
              Auto-detect shared columns or manually link them
            </p>
          </div>
          <div className="rounded-lg bg-white p-4 shadow-sm">
            <h3 className="font-medium text-gray-900">3. Download merged results</h3>
            <p className="text-sm text-gray-500">
              Each target row matched to its closest supplemental row
            </p>
          </div>
        </div>

        <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <button
            onClick={() => navigate("/match")}
            className="rounded-xl bg-blue-600 px-8 py-3 text-lg font-semibold text-white shadow-lg transition-colors hover:bg-blue-700"
          >
            Get Started
          </button>
          <Link
            to="/about"
            className="rounded-xl border border-gray-300 bg-white px-8 py-3 text-lg font-semibold text-gray-700 shadow-sm transition-colors hover:bg-gray-50"
          >
            How it works
          </Link>
        </div>

        <div className="mt-6 rounded-lg bg-green-50 p-3">
          <p className="text-sm text-green-700">
            Your data never leaves your browser. All matching is performed
            client-side.
          </p>
        </div>
      </div>
    </div>
  );
}