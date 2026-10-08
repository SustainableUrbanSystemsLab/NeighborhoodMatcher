/// <reference types="vite/client" />

// Build-time constants injected by vite.config.ts (see `define`). They
// identify the deployed site — the ENGINE's version travels with each run
// in MatchOutput.provenance, which is what a results package reports.
declare const __APP_VERSION__: string;
declare const __APP_COMMIT__: string;
declare const __BUILD_TIME__: string;
