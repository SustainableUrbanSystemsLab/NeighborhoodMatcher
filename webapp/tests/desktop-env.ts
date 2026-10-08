// Shared emulation of the desktop app's environment for Playwright:
// the Content-Security-Policy from src-tauri/tauri.conf.json exactly as Tauri
// serves it (HTML responses only, sha256 of every inline <script> appended
// to script-src, style-src untouched), and — optionally — Tauri's IPC bridge
// (`window.isTauri` + `window.__TAURI_INTERNALS__.invoke`) with scripted
// command handlers, so the page takes its desktop code paths.

import type { Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function desktopCsp(): string {
  const conf = JSON.parse(readFileSync(resolve(APP, "src-tauri/tauri.conf.json"), "utf-8"));
  const csp: string = conf.app.security.csp;
  // The HTML parser turns CRLF into LF before a script's hash is taken, and
  // git on Windows may check index.html out with CRLF: hash what the
  // browser hashes.
  const html = readFileSync(resolve(APP, "dist/index.html"), "utf-8").replace(/\r\n?/g, "\n");
  const hashes = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(
    (m) => `'sha256-${createHash("sha256").update(m[1]!).digest("base64")}'`
  );
  return csp
    .split(";")
    .map((d) => d.trim())
    .map((d) => (d.startsWith("script-src ") ? `${d} ${hashes.join(" ")}` : d))
    .join("; ");
}

/** Serve every HTML document under the desktop CSP; record violations. */
export async function applyDesktopCsp(page: Page): Promise<void> {
  const csp = desktopCsp();
  await page.route("**/*", async (route) => {
    if (route.request().resourceType() !== "document") return route.continue();
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: { ...response.headers(), "content-security-policy": csp },
    });
  });
  await page.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => {
      (window as unknown as { __csp: string[] }).__csp.push(
        `${e.violatedDirective} ${e.blockedURI}`
      );
    });
  });
}

export async function cspViolations(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
}

/**
 * Pretend to be the desktop app: `isTauri()` is true and `invoke` answers the
 * app's commands. Every call is recorded on `window.__ipc` for assertions.
 * `selftest` switches the NBHDMATCH_SELFTEST mode on.
 */
export async function emulateTauri(page: Page, { selftest }: { selftest: boolean }): Promise<void> {
  await page.addInitScript((selftestOn: boolean) => {
    type Call = { cmd: string; args: unknown; headers?: Record<string, string>; bytes?: number };
    const w = window as unknown as {
      isTauri: boolean;
      __ipc: Call[];
      __TAURI_INTERNALS__: unknown;
    };
    w.isTauri = true;
    w.__ipc = [];
    let nextId = 1;
    w.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      transformCallback: () => nextId++,
      unregisterCallback: () => {},
      convertFileSrc: (p: string) => p,
      async invoke(cmd: string, args: unknown, options?: { headers?: Record<string, string> }) {
        const call: Call = { cmd, args, headers: options?.headers };
        if (args instanceof Uint8Array) {
          call.bytes = args.byteLength;
          call.args = null;
        }
        w.__ipc.push(call);
        switch (cmd) {
          case "selftest_mode":
            return selftestOn;
          case "save_download":
            return `/Users/test/Downloads/${options?.headers?.["x-filename"] ?? "unnamed"}`;
          case "selftest_report":
          case "plugin:opener|open_url":
            return null;
          default:
            throw new Error(`unexpected command ${cmd}`);
        }
      },
    };
  }, selftest);
}
