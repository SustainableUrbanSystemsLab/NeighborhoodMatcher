#!/usr/bin/env node
// Builds NeighborhoodMatcher end to end: the website, the self-host zip, and
// the desktop app for this computer, collected in release/.
//
// This is the logic behind ./build.sh (macOS, Linux) and build.bat (Windows);
// both only check that Node.js is installed and hand over to this script, so
// every platform runs exactly the same steps. Run with --help for options.

import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WEBAPP = join(ROOT, "webapp");
const MATCHER = join(ROOT, "matcher");
const RELEASE = join(ROOT, "release");
const IS_WIN = process.platform === "win32";
const IS_MAC = process.platform === "darwin";
const IS_LINUX = process.platform === "linux";
const WRAPPER = IS_WIN ? "build.bat" : "./build.sh";

const HELP = `Build NeighborhoodMatcher: the website, the self-host zip, and the desktop
app for this computer. Outputs go to release/, which is recreated on every run.

  ./build.sh [options]     macOS, Linux
  build.bat  [options]     Windows

Options:
  --web-only   skip the desktop app (no Rust toolchain needed)
  --test       also run the Python tests and the benchmark, the Playwright
               end-to-end tests, and the built desktop app's self-test
  --help       show this help

Outputs in release/:
  nbhdmatch-site-v<version>.zip                 the website for any static web
                                                server (HOSTING.txt inside)
  NeighborhoodMatcher_<version>_<arch>.dmg      desktop app, macOS
  NeighborhoodMatcher_<version>_x64-setup.exe   desktop installer, Windows
                                                (WebView2 runtime included)

Needs Node.js 20 or newer; the pinned pnpm is provided automatically (corepack
or npx). The desktop app also needs Rust (https://rustup.rs) plus the Xcode
Command Line Tools on macOS, or Visual Studio Build Tools with "Desktop
development with C++" on Windows. --test also needs uv
(https://docs.astral.sh/uv/). The build downloads packages, the numpy wheel
and, on Windows, the WebView2 installer, so it needs Internet access; what it
produces does not. On Linux the desktop app is skipped: it is built for macOS
and Windows.`;

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

const opts = { webOnly: false, test: false };
for (const arg of process.argv.slice(2)) {
  if (arg === "--web-only") opts.webOnly = true;
  else if (arg === "--test") opts.test = true;
  else if (arg === "--help" || arg === "-h" || arg === "/?") {
    console.log(HELP);
    process.exit(0);
  } else {
    console.error(`Unknown option: ${arg}\n`);
    console.error(HELP);
    process.exit(2);
  }
}
const buildDesktop = !opts.webOnly && (IS_MAC || IS_WIN);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const started = Date.now();

function fail(message) {
  console.error(`\nerror: ${message}`);
  process.exit(1);
}

function duration(ms) {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

let env = {
  ...process.env,
  // package.json pins pnpm; corepack must not fetch "latest" (stale signing
  // keys break that) nor stop to ask before downloading the pinned version.
  COREPACK_DEFAULT_TO_LATEST: "0",
  COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
};

/** Prepends a directory to PATH, respecting Windows' "Path" spelling. */
function prependPath(dir) {
  const key = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  env = { ...env, [key]: `${dir}${IS_WIN ? ";" : ":"}${env[key] ?? ""}` };
}

// On Windows, .cmd shims (pnpm.cmd, npx.cmd) only run through the shell.
function quoteForCmd(arg) {
  return /[\s"&|<>^()%!]/.test(arg) ? `"${arg}"` : arg;
}

function spawnCommand(cmd, args, options) {
  return IS_WIN
    ? spawnSync([cmd, ...args].map(quoteForCmd).join(" "), { ...options, shell: true })
    : spawnSync(cmd, args, options);
}

/** Runs a command with live output; exits the build if it fails. */
function run(cmd, args, cwd = ROOT, extraEnv = {}) {
  console.log(`$ ${[cmd, ...args].join(" ")}${cwd === ROOT ? "" : `   (in ${relative(ROOT, cwd)})`}`);
  const result = spawnCommand(cmd, args, { cwd, env: { ...env, ...extraEnv }, stdio: "inherit" });
  if (result.error) fail(`could not run ${cmd}: ${result.error.message}`);
  if (result.status !== 0) fail(`${[cmd, ...args].join(" ")} failed (exit code ${result.status})`);
}

/** Runs a command quietly and returns its trimmed output, or null. */
function capture(cmd, args, cwd = ROOT) {
  const result = spawnCommand(cmd, args, { cwd, env, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.error || result.status !== 0) return null;
  return (result.stdout ?? "").trim();
}

/** Finds a tool on PATH, or in its usual install folder when a fresh install has not reached PATH yet. */
function findTool(name, fallbackDirs) {
  if (capture(name, ["--version"]) !== null) return true;
  for (const dir of fallbackDirs) {
    if (existsSync(join(dir, IS_WIN ? `${name}.exe` : name))) {
      prependPath(dir);
      return capture(name, ["--version"]) !== null;
    }
  }
  return false;
}

const stepTitles = [
  "Checking prerequisites",
  "Installing JavaScript dependencies",
  opts.test && "Running the Python tests and the benchmark",
  "Building the website and the self-host zip",
  "Checking that the build needs no Internet",
  opts.test && "Running the end-to-end tests (Playwright)",
  buildDesktop && "Building the desktop app",
  buildDesktop && opts.test && "Self-testing the desktop app",
  buildDesktop && opts.test && IS_MAC && "Testing the Terminal installer",
].filter(Boolean);
let stepIndex = 0;
function step(title) {
  if (stepTitles[stepIndex] !== title) throw new Error(`step order: ${title}`);
  stepIndex += 1;
  console.log(`\n==> [${stepIndex}/${stepTitles.length}] ${title}`);
}

// ---------------------------------------------------------------------------
// 1. Prerequisites (all checked before anything slow starts)
// ---------------------------------------------------------------------------

step("Checking prerequisites");

const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor < 20) fail(`Node.js 20 or newer is required, found ${process.version}. Get it from https://nodejs.org/`);

const pkg = JSON.parse(readFileSync(join(WEBAPP, "package.json"), "utf-8"));
const VERSION = pkg.version;
const PNPM_VERSION = /^pnpm@([^+]+)/.exec(pkg.packageManager ?? "")?.[1];
if (!PNPM_VERSION) fail("webapp/package.json does not pin a pnpm version (packageManager)");

// pnpm must be callable as plain `pnpm`: package scripts and the desktop
// build (tauri's beforeBuildCommand) call it that way. Use the one on PATH if
// it is the pinned version, else put a shim for the pinned version first on
// PATH — via corepack (ships with Node) or, failing that, npx.
let pnpmSource = "already installed";
if (capture("pnpm", ["--version"], WEBAPP) !== PNPM_VERSION) {
  const shimDir = mkdtempSync(join(tmpdir(), "nbhdmatch-pnpm-"));
  if (capture("corepack", ["--version"]) !== null) {
    run("corepack", ["enable", "--install-directory", shimDir, "pnpm"]);
    pnpmSource = "corepack";
  } else if (IS_WIN) {
    writeFileSync(join(shimDir, "pnpm.cmd"), `@npx --yes pnpm@${PNPM_VERSION} %*\r\n`);
    pnpmSource = "npx";
  } else {
    writeFileSync(join(shimDir, "pnpm"), `#!/bin/sh\nexec npx --yes "pnpm@${PNPM_VERSION}" "$@"\n`);
    chmodSync(join(shimDir, "pnpm"), 0o755);
    pnpmSource = "npx";
  }
  prependPath(shimDir);
  const got = capture("pnpm", ["--version"], WEBAPP);
  if (got !== PNPM_VERSION) {
    fail(`could not provide pnpm ${PNPM_VERSION} (got ${got ?? "nothing"}). Install it with: npm install -g pnpm@${PNPM_VERSION}`);
  }
}

if (buildDesktop) {
  if (!findTool("cargo", [join(homedir(), ".cargo", "bin")])) {
    fail(
      "the desktop app needs Rust, which was not found.\n" +
        (IS_WIN
          ? "  Install it with:  winget install --id Rustlang.Rustup\n" +
            '  plus Visual Studio Build Tools with "Desktop development with C++":\n' +
            "  https://visualstudio.microsoft.com/visual-cpp-build-tools/\n"
          : "  Install it with:  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh\n") +
        `  Then open a new terminal and run ${WRAPPER} again — or build without the desktop app: ${WRAPPER} --web-only`
    );
  }
  if (IS_MAC && capture("xcode-select", ["-p"]) === null) {
    fail("the desktop app needs the Xcode Command Line Tools. Install them with: xcode-select --install");
  }
  if (IS_WIN) {
    const vswhere = join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Microsoft Visual Studio", "Installer", "vswhere.exe");
    const msvc = existsSync(vswhere)
      ? capture(vswhere, ["-products", "*", "-requires", "Microsoft.VisualStudio.Component.VC.Tools.x86.x64", "-property", "installationPath"])
      : null;
    if (!msvc) {
      console.warn(
        'warning: Visual Studio Build Tools with "Desktop development with C++" were not found.\n' +
          "  If the desktop build fails with \"link.exe not found\", install them from\n" +
          "  https://visualstudio.microsoft.com/visual-cpp-build-tools/"
      );
    }
  }
}

if (opts.test && !findTool("uv", [join(homedir(), ".local", "bin"), join(homedir(), ".cargo", "bin")])) {
  fail("--test needs uv for the Python tests: https://docs.astral.sh/uv/getting-started/installation/");
}

console.log(`NeighborhoodMatcher ${VERSION} on ${process.platform}/${process.arch}`);
console.log(`Node.js ${process.version}; pnpm ${PNPM_VERSION} (${pnpmSource})`);
if (buildDesktop) console.log(`Rust: ${capture("cargo", ["--version"])}`);
if (!buildDesktop) {
  console.log(
    opts.webOnly
      ? "Desktop app: skipped (--web-only)"
      : "Desktop app: skipped — it is built for macOS and Windows only"
  );
}
if (opts.test) console.log(`Tests: on (${capture("uv", ["--version"])})`);

rmSync(RELEASE, { recursive: true, force: true });
mkdirSync(RELEASE, { recursive: true });

// ---------------------------------------------------------------------------
// 2. Dependencies
// ---------------------------------------------------------------------------

step("Installing JavaScript dependencies");
run("pnpm", ["install", "--frozen-lockfile"], WEBAPP);

// ---------------------------------------------------------------------------
// 3. Python tests
// ---------------------------------------------------------------------------

if (opts.test) {
  step("Running the Python tests and the benchmark");
  run("uv", ["run", "--project", ".", "pytest", "-q"], MATCHER);
  run("uv", ["run", "--project", ".", "python", "analysis/benchmark_simulated.py", "--check"], MATCHER);
}

// ---------------------------------------------------------------------------
// 4. Website + self-host zip, and the offline check
// ---------------------------------------------------------------------------

step("Building the website and the self-host zip");
run("pnpm", ["build"], WEBAPP);
const siteZip = `nbhdmatch-site-v${VERSION}.zip`;
const siteZipPath = join(WEBAPP, "dist", "offline", siteZip);
if (!existsSync(siteZipPath)) fail(`the build did not produce webapp/dist/offline/${siteZip}`);
// Copied now: the desktop build below rebuilds dist/ without the zip.
copyFileSync(siteZipPath, join(RELEASE, siteZip));

step("Checking that the build needs no Internet");
run("pnpm", ["run", "check:offline"], WEBAPP);

// ---------------------------------------------------------------------------
// 5. End-to-end tests (against the production build in dist/)
// ---------------------------------------------------------------------------

if (opts.test) {
  step("Running the end-to-end tests (Playwright)");
  const withDeps = IS_LINUX && process.env.CI ? ["--with-deps"] : [];
  run("pnpm", ["exec", "playwright", "install", ...withDeps, "chromium", "webkit"], WEBAPP);
  run("pnpm", ["exec", "playwright", "test"], WEBAPP);
}

// ---------------------------------------------------------------------------
// 6. Desktop app
// ---------------------------------------------------------------------------

const BUNDLE = join(WEBAPP, "src-tauri", "target", "release", "bundle");

function builtFiles(dir, pattern) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => pattern.test(name) && name.includes(`_${VERSION}_`))
    .map((name) => join(dir, name));
}

/** Mounts a .dmg read-only, passes the .app inside to fn, and unmounts it again. */
async function withAppInDmg(dmg, fn) {
  const mount = mkdtempSync(join(tmpdir(), "nbhdmatch-dmg-"));
  run("hdiutil", ["attach", "-nobrowse", "-readonly", "-mountpoint", mount, dmg]);
  try {
    const app = readdirSync(mount).find((name) => name.endsWith(".app"));
    if (!app) fail("no .app inside the .dmg");
    return await fn(join(mount, app));
  } finally {
    spawnSync("hdiutil", ["detach", mount, "-force"], { stdio: "ignore" });
  }
}

let installer = null;
if (buildDesktop) {
  step("Building the desktop app");
  // tauri build runs `pnpm build:web` (the site without the zip) and bundles it.
  run("pnpm", ["desktop:build"], WEBAPP);
  const found = IS_MAC
    ? builtFiles(join(BUNDLE, "dmg"), /\.dmg$/)
    : builtFiles(join(BUNDLE, "nsis"), /-setup\.exe$/);
  if (found.length === 0) fail(`the desktop build produced no installer in ${relative(ROOT, BUNDLE)}`);
  installer = found[0];
  if (IS_MAC) {
    // A downloaded app whose signature covers only its executable (all the
    // linker signs on Apple Silicon) is "damaged" to macOS, with no way to
    // open it. signingIdentity "-" in tauri.conf.json has tauri sign the whole
    // app (ad hoc); this keeps it that way. The self-test cannot catch it: it
    // runs a copy that was never downloaded, which Gatekeeper does not vet.
    const problem = await withAppInDmg(installer, (app) => {
      const check = spawnSync("codesign", ["--verify", "--deep", "--strict", app], { encoding: "utf-8" });
      return check.status === 0 ? null : (check.stderr || `codesign exit code ${check.status}`).trim();
    });
    if (problem) fail(`the app in the .dmg is not signed as a whole, so macOS would call it damaged once downloaded:\n${problem}`);
    console.log("Code signature: valid for the whole app (codesign --verify --deep --strict)");
  }
  copyFileSync(installer, join(RELEASE, installer.split(/[\\/]/).pop()));
}

// ---------------------------------------------------------------------------
// 7. Desktop self-test: the built app runs a full match in its own webview
//    (webapp/src/lib/desktop-selftest.ts), saves the results package, checks
//    that the network is blocked, writes PASS/FAIL and exits.
// ---------------------------------------------------------------------------

async function selftest(binary) {
  const dir = mkdtempSync(join(tmpdir(), "nbhdmatch-selftest-"));
  const report = join(dir, "report.txt");
  const downloads = join(dir, "downloads");
  mkdirSync(downloads);
  console.log(`$ ${binary}   (NBHDMATCH_SELFTEST=${report})`);
  const child = spawn(binary, [], {
    env: { ...env, NBHDMATCH_SELFTEST: report, NBHDMATCH_DOWNLOAD_DIR: downloads },
    stdio: "ignore",
  });
  const exited = new Promise((done) => {
    child.on("exit", () => done("exit"));
    child.on("error", () => done("exit"));
  });
  let timer;
  const timeout = new Promise((done) => {
    timer = setTimeout(() => done("timeout"), 360_000);
  });
  const outcome = await Promise.race([exited, timeout]);
  clearTimeout(timer);
  if (outcome === "timeout") child.kill();
  const text = existsSync(report) ? readFileSync(report, "utf-8").trim() : "";
  if (!text.startsWith("PASS")) fail(`the desktop self-test failed: ${text || "the app wrote no report"}`);
  if (!existsSync(join(downloads, "selftest-results.zip"))) fail("the desktop self-test did not save its results package");
  console.log(text);
}

if (buildDesktop && opts.test) {
  step("Self-testing the desktop app");
  if (IS_MAC) {
    // Test the app inside the .dmg that ships (the build deletes the loose .app).
    await withAppInDmg(installer, (app) => {
      const macos = join(app, "Contents", "MacOS");
      return selftest(join(macos, readdirSync(macos)[0]));
    });
  } else {
    const release = join(WEBAPP, "src-tauri", "target", "release");
    const exe = readdirSync(release).find((name) => name.endsWith(".exe"));
    if (!exe) fail("no built .exe in webapp/src-tauri/target/release");
    await selftest(join(release, exe));
  }
}

// ---------------------------------------------------------------------------
// 8. The Terminal installer (scripts/install-macos.sh, a release asset): the
//    usual case is a .dmg downloaded with a browser, which carries the
//    quarantine flag. The installed app must not, or macOS blocks it at
//    first launch, and it must pass the signature check the script runs.
// ---------------------------------------------------------------------------

if (buildDesktop && opts.test && IS_MAC) {
  step("Testing the Terminal installer");
  const dir = mkdtempSync(join(tmpdir(), "nbhdmatch-install-"));
  const dmg = join(dir, "NeighborhoodMatcher.dmg");
  copyFileSync(installer, dmg);
  run("xattr", ["-w", "com.apple.quarantine", "0083;00000000;Chrome;", dmg]);
  const installDir = join(dir, "Applications");
  run("sh", [join(ROOT, "scripts", "install-macos.sh")], ROOT, {
    NBHDMATCH_DMG: dmg,
    NBHDMATCH_INSTALL_DIR: installDir,
    NBHDMATCH_NO_OPEN: "1",
  });
  const app = join(installDir, "NeighborhoodMatcher.app");
  if (!existsSync(join(app, "Contents", "Info.plist"))) fail("the installer did not put the app in NBHDMATCH_INSTALL_DIR");
  if (spawnSync("xattr", ["-p", "com.apple.quarantine", app], { stdio: "ignore" }).status === 0) {
    fail("the installed app still carries the quarantine flag");
  }
  console.log(`Installed from a quarantined .dmg, no quarantine flag on the app: ${app}`);
  rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\nDone in ${duration(Date.now() - started)}. In release/:`);
for (const name of readdirSync(RELEASE).sort()) {
  const mb = statSync(join(RELEASE, name)).size / 1e6;
  console.log(`  ${name.padEnd(46)} ${mb.toFixed(1).padStart(6)} MB`);
}
console.log("The built website is also in webapp/dist/ (serve that folder as is).");
