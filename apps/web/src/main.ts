import "./polyfills.js";
import { installGlobalErrorHandlers } from "./logger.js";
import { startApp } from "./runtime.js";
import { preloadAssets } from "./app/preloader.js";
import "./styles.css";

installGlobalErrorHandlers();
// Warm every visual asset (+ SFX) behind the boot loading screen first, so the
// menu and every page after it render without missing-image flicker. startApp's
// first render replaces the splash markup that index.html paints immediately.
void preloadAssets().finally(() => startApp());
