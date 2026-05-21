import "./polyfills.js";
import { installGlobalErrorHandlers } from "./logger.js";
import { startApp } from "./runtime.js";
import "./styles.css";

installGlobalErrorHandlers();
startApp();
