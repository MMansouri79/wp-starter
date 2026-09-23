export type LogLevel = "quiet" | "info" | "debug";

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug(message: string): void;
}

export function createLogger(level: LogLevel, sink: (line: string) => void = console.log): Logger {
  const stamp = () => new Date().toISOString();
  const write = (label: string, message: string) => sink(`${stamp()} ${label} ${message}`);

  return {
    info: (message) => {
      if (level !== "quiet") write("INFO ", message);
    },
    warn: (message) => {
      if (level !== "quiet") write("WARN ", message);
    },
    error: (message) => {
      if (level !== "quiet") write("ERROR", message);
    },
    debug: (message) => {
      if (level === "debug") write("DEBUG", message);
    }
  };
}

export const silentLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined
};
