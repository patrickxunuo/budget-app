import "server-only";

const MAX_ROUTE_LOADING_DELAY_MS = 5_000;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

type RouteLoadingEnvironment = Readonly<Record<string, string | undefined>>;

type Wait = (milliseconds: number) => Promise<void>;

function configuredDelay(environment: RouteLoadingEnvironment) {
  const rawDelay = environment.E2E_ROUTE_LOADING_DELAY_MS;
  if (!rawDelay) return null;

  let appUrl: URL;
  try {
    appUrl = new URL(environment.APP_URL ?? "");
  } catch {
    return null;
  }

  // This hook exists solely to give the production-mode Playwright suite a
  // deterministic streaming window. Keep it unreachable in every deployment,
  // even if somebody copies the test variable into hosted configuration.
  if (
    environment.CI !== "true" ||
    environment.E2E_SERVER_MODE !== "start" ||
    environment.PLAID_E2E_PROVIDER !== "deterministic" ||
    !LOOPBACK_HOSTS.has(appUrl.hostname) ||
    environment.VERCEL === "1" ||
    environment.VERCEL_ENV
  ) {
    return null;
  }

  const milliseconds = Number(rawDelay);
  if (
    !Number.isInteger(milliseconds) ||
    milliseconds < 1 ||
    milliseconds > MAX_ROUTE_LOADING_DELAY_MS
  ) {
    throw new Error(
      `E2E_ROUTE_LOADING_DELAY_MS must be an integer from 1 to ${MAX_ROUTE_LOADING_DELAY_MS}`,
    );
  }
  return milliseconds;
}

export async function delayRouteForE2E(
  environment: RouteLoadingEnvironment = process.env,
  wait: Wait = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
) {
  const milliseconds = configuredDelay(environment);
  if (milliseconds === null) return;
  await wait(milliseconds);
}
