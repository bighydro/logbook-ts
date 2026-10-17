/**
 * The time a test that starts a child process is given: set on each such test, as the last argument
 * of `it`, and never as vitest's `testTimeout`, since a budget for every test would hide a real hang
 * in a test that starts nothing, which the default five seconds still ends.
 *
 * A child costs its start, and a start on the Windows runners costs several times what it does on
 * Linux: past five seconds there, such a test fails for the runner, not for the code. A child waited
 * for with spawnSync holds the test, so vitest cannot end it sooner; it fails the test once it
 * returns, if it ran past its budget (a child that might never end has a spawnSync timeout of its
 * own).
 *
 * Measured: each file that starts a child, alone, five times (Linux, 4 cores, Node 22, 2026-10-17);
 * each budget is about four times the slowest such test, and never under 15 s. A test that already
 * sets a larger timeout keeps it.
 */

/**
 * A test that starts a worker, a holder of the lock, a toucher or a child with a capped heap. The
 * slowest: 8.78 s, verify-memory's repair tail of a tail the whole record long, in a child.
 */
export const SPAWN_BUDGET_MS = 35_000;

/**
 * A test that runs the reference (Python, through `uv run`), once or many times. The slowest:
 * 25.3 s, cross-impl's `day` of every day of rfc0037-0038-sample, as text and as JSON.
 */
export const CROSS_IMPL_BUDGET_MS = 100_000;
