type LogLevel = "debug" | "info" | "warn" | "error";

export type LogContext = {
  requestId?: string;
  path?: string;
  method?: string;
  userId?: string;
  extra?: Record<string, unknown>;
};

function nowIso() {
  return new Date().toISOString();
}

function write(level: LogLevel, message: string, ctx?: LogContext, err?: unknown) {
  const payload: Record<string, unknown> = {
    ts: nowIso(),
    level,
    message,
    ...ctx,
  };

  if (err instanceof Error) {
    payload.error = {
      name: err.name,
      message: err.message,
      stack: err.stack,
    };
  } else if (err != null) {
    payload.error = err;
  }

  const line = JSON.stringify(payload);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (message: string, ctx?: LogContext) => write("debug", message, ctx),
  info: (message: string, ctx?: LogContext) => write("info", message, ctx),
  warn: (message: string, ctx?: LogContext) => write("warn", message, ctx),
  error: (message: string, ctx?: LogContext, err?: unknown) =>
    write("error", message, ctx, err),
};

