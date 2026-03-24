export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LoggerContext {
  [key: string]: bigint | boolean | number | string | null | undefined;
}

export interface Logger {
  child(bindings: LoggerContext): Logger;
  debug(message: string, context?: LoggerContext): void;
  info(message: string, context?: LoggerContext): void;
  warn(message: string, context?: LoggerContext): void;
  error(message: string, context?: LoggerContext): void;
}

function normalize(value: LoggerContext[keyof LoggerContext]): boolean | number | string | null {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (value === undefined) {
    return null;
  }
  return value;
}

class JsonLogger implements Logger {
  public constructor(private readonly bindings: LoggerContext = {}) {}

  public child(bindings: LoggerContext): Logger {
    return new JsonLogger({ ...this.bindings, ...bindings });
  }

  public debug(message: string, context?: LoggerContext): void {
    this.write("debug", message, context);
  }

  public info(message: string, context?: LoggerContext): void {
    this.write("info", message, context);
  }

  public warn(message: string, context?: LoggerContext): void {
    this.write("warn", message, context);
  }

  public error(message: string, context?: LoggerContext): void {
    this.write("error", message, context);
  }

  private write(level: LogLevel, message: string, context?: LoggerContext): void {
    const payload: Record<string, boolean | number | string | null> = {
      level,
      message,
      timestamp: new Date().toISOString(),
    };
    for (const [key, value] of Object.entries({ ...this.bindings, ...context })) {
      payload[key] = normalize(value);
    }
    console.log(JSON.stringify(payload));
  }
}

export function createLogger(bindings?: LoggerContext): Logger {
  return new JsonLogger(bindings);
}
