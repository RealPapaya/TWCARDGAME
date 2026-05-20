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
  const record = { ts: new Date().toISOString(), level, event, ...fields };
  const line = `${JSON.stringify(record, jsonReplacer)}\n`;
  if (level === "error") process.stderr.write(line);
  else process.stdout.write(line);
}

export const logger: Logger = {
  info: (event, fields) => emit("info", event, fields),
  warn: (event, fields) => emit("warn", event, fields),
  error: (event, fields) => emit("error", event, fields)
};
