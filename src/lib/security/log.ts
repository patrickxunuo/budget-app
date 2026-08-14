import { redact } from "./redact";

export type ServerLogLevel = "info" | "warn" | "error";

/**
 * The only sanctioned `console.*` site in server code. Every other server
 * module logs through here so no context object can reach a log stream
 * unredacted; a guard test fails the build if a raw `console.*` reappears
 * under `src/lib/**`, `src/app/api/**`, or `src/proxy.ts`.
 */
export function logServerEvent(
  level: ServerLogLevel,
  message: string,
  context?: unknown,
): void {
  const payload = context === undefined ? [] : [redact(context)];
  if (level === "error") console.error(message, ...payload);
  else if (level === "warn") console.warn(message, ...payload);
  else console.info(message, ...payload);
}
