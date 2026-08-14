import {
  assertRequiredFixturesProvisioned,
  reportFixtureInventory,
} from "./fixtures";

/**
 * Runs once at the end of the whole run, after every project and worker.
 *
 * The inventory has to be reported from here rather than a `test.afterAll`: a
 * per-file hook fires once per Playwright project (and, under `fullyParallel`,
 * once per worker that touched the file), so the same inventory printed two or
 * more times and each copy read like a separate verdict.
 *
 * The assertion runs last and deliberately throws: a fixture family named in
 * E2E_REQUIRED_FIXTURES but never provisioned must fail the run even when the
 * spec that needed it was skipped by an outer gate and its own requireFixture
 * was never reached. That case is exactly the silent-skip this ticket closes.
 */
export default function globalTeardown(): void {
  reportFixtureInventory();
  assertRequiredFixturesProvisioned();
}
