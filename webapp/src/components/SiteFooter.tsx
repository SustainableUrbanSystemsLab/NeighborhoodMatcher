// Site-wide footer: a link to the source, the version of the running build,
// and who made the tool. Shown on every page so a researcher can always tell
// which version they are using and where the code lives.
//
// The GitHub mark is inline SVG rather than a row of status badges: badges
// are noise on a tool page, and fetching them from shields.io / Netlify would
// be the only third-party request this app makes — at odds with "your data
// never leaves your browser". Live CI and deploy status belong in the README,
// where they are about the repository rather than about this page.

import {
  AUTHOR_URLS,
  AUTHORS,
  ORGANIZATION,
  ORGANIZATION_URL,
  REPO_URL,
  TOOL_NAME,
  buildLabel,
} from "@/lib/about";

const FOOTER_LINK = "underline decoration-gray-300 underline-offset-2 hover:text-gray-700 dark:decoration-gray-600";

/**
 * "Developed by A, B, and C" with each name linked to AUTHOR_URLS[name]
 * when one exists (an author with no entry is plain text) — same "A and B" /
 * "A, B, and C" joiner as AUTHORS_LINE, built by hand because AUTHORS_LINE
 * itself is a flat string with nowhere to hang a link.
 */
function AuthorCredit() {
  return (
    <>
      Developed by{" "}
      {AUTHORS.map((name, i) => {
        const url = AUTHOR_URLS[name];
        const sep =
          i === 0 ? "" : i < AUTHORS.length - 1 ? ", " : AUTHORS.length > 2 ? ", and " : " and ";
        return (
          <span key={name}>
            {sep}
            {url ? (
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                title={`${name}'s profile`}
                className={FOOTER_LINK}
              >
                {name}
              </a>
            ) : (
              name
            )}
          </span>
        );
      })}
    </>
  );
}

/** GitHub's official mark (octicon mark-github-16). */
function GitHubMark() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.012 8.012 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

export function SiteFooter({ className = "" }: { className?: string }) {
  return (
    <footer
      className={`mt-10 border-t border-gray-200 pt-4 text-center text-xs text-gray-500 ${className}`}
    >
      <a
        href={REPO_URL}
        target="_blank"
        rel="noreferrer"
        title={`${TOOL_NAME} on GitHub — source code and issue tracker`}
        aria-label={`${TOOL_NAME} on GitHub — source code and issue tracker`}
        className="inline-flex items-center gap-1.5 text-gray-400 transition-colors hover:text-gray-700"
      >
        <GitHubMark />
        <span className="sr-only">Source code and issue tracker</span>
      </a>
      <div className="mt-2 space-y-0.5 leading-relaxed">
        <p>
          <span className="font-medium text-gray-600">{TOOL_NAME}</span>{" "}
          {buildLabel()}
        </p>
        <p>
          <AuthorCredit />
        </p>
        <p>
          <a
            href={ORGANIZATION_URL}
            target="_blank"
            rel="noreferrer"
            title={`${ORGANIZATION} website`}
            className={FOOTER_LINK}
          >
            {ORGANIZATION}
          </a>
        </p>
      </div>
    </footer>
  );
}
