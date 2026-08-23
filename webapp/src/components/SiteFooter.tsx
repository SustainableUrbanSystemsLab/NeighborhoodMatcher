// Site-wide footer: project badges, version of the running build, and who
// made the tool. Shown on every page so a researcher can always tell which
// version they are using and where the source lives.
//
// The badge images are the same ones the README uses (CI + deploy status),
// so they show LIVE status rather than a claim baked into the bundle. They
// are the only third-party requests the app makes; no-referrer keeps the
// visited URL out of the request, and the page works fine if they fail to
// load.

import {
  AUTHORS_LINE,
  ORGANIZATION,
  REPO_URL,
  TOOL_NAME,
  buildLabel,
} from "@/lib/about";

const BADGES = [
  {
    href: REPO_URL,
    src: "https://img.shields.io/badge/GitHub-NeighborhoodMatcher-181717?logo=github",
    alt: "Source on GitHub",
  },
  {
    href: `${REPO_URL}/actions/workflows/python-tests.yml`,
    src: `${REPO_URL}/actions/workflows/python-tests.yml/badge.svg`,
    alt: "Python tests status",
  },
  {
    href: "https://app.netlify.com/projects/nbhdmatch/deploys",
    src: "https://api.netlify.com/api/v1/badges/f2fe942a-24a9-41d3-9ed6-29dac67da9b3/deploy-status",
    alt: "Netlify deploy status",
  },
];

export function SiteFooter({ className = "" }: { className?: string }) {
  return (
    <footer
      className={`mt-10 border-t border-gray-200 pt-4 text-center text-xs text-gray-500 ${className}`}
    >
      <div className="mb-2 flex flex-wrap items-center justify-center gap-2">
        {BADGES.map((b) => (
          <a key={b.alt} href={b.href} target="_blank" rel="noreferrer">
            <img
              src={b.src}
              alt={b.alt}
              height={20}
              className="h-5"
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          </a>
        ))}
      </div>
      <p>
        <span className="font-medium text-gray-600">{TOOL_NAME}</span>{" "}
        {buildLabel()} · Developed by {AUTHORS_LINE} · {ORGANIZATION}
      </p>
      <p className="mt-1">
        <a
          href={REPO_URL}
          target="_blank"
          rel="noreferrer"
          className="text-blue-600 dark:text-blue-400 hover:text-blue-800"
        >
          Source code and issue tracker
        </a>
      </p>
    </footer>
  );
}
