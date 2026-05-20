type LogLevel = "info" | "warn" | "error";
type LogFields = Record<string, unknown>;

export interface Logger {
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

function jsonReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  return value;
}

function emit(level: LogLevel, event: string, fields?: LogFields): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...fields }, jsonReplacer);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}

export const logger: Logger = {
  info: (event, fields) => emit("info", event, fields),
  warn: (event, fields) => emit("warn", event, fields),
  error: (event, fields) => emit("error", event, fields)
};

let installed = false;

export function installGlobalErrorHandlers(): void {
  if (installed) return;
  installed = true;
  window.addEventListener("error", (event) => {
    logger.error("window.error", {
      message: event.message,
      source: event.filename,
      line: event.lineno,
      column: event.colno,
      error: event.error
    });
  });
  window.addEventListener("unhandledrejection", (event) => {
    logger.error("window.unhandledrejection", { reason: event.reason });
  });
}
