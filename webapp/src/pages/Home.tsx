import { Link, useNavigate } from "react-router";
import { SiteFooter } from "@/components/SiteFooter";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useTheme } from "@/lib/use-theme";

export default function Home() {
  const navigate = useNavigate();
  const theme = useTheme();

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas p-4">
      <div className="w-full max-w-xl text-center">
        <div className="mb-2 flex justify-end">
          <ThemeToggle theme={theme} />
        </div>
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
          <div className="rounded-lg border border-gray-200 bg-surface p-4">
            <h3 className="font-medium text-gray-900">1. Upload two datasets</h3>
            <p className="text-sm text-gray-500">
              A target dataset (the one you want to add information to) and a
              supplemental dataset (the source of that information, e.g. a
              census extract), both CSV
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-surface p-4">
            <h3 className="font-medium text-gray-900">2. Link matching columns</h3>
            <p className="text-sm text-gray-500">
              Auto-detect shared columns or manually link them
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-surface p-4">
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
            className="rounded-xl border border-gray-300 bg-surface px-8 py-3 text-lg font-semibold text-gray-700 shadow-sm transition-colors hover:bg-gray-50"
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
        <p className="mt-3 text-xs text-gray-500">
          Works without Internet: after this visit the app keeps running
          offline on this device, and it can be installed from the browser
          menu. For a machine with no web access at all, or to host a copy
          inside your institution, see{" "}
          <Link to="/about#offline" className="text-blue-600 dark:text-blue-400 underline hover:text-blue-800">
            Use it without Internet
          </Link>
          .
        </p>

        <SiteFooter />
      </div>
    </div>
  );
}