/**
 * Correctness-critical: an account that stopped paying still polling, on our
 * bill. `schedule.test.ts`, *which owners the gate admits*, holds the
 * assertions, and they were written first.
 *
 * Who may poll is the application's question, not the pipeline's. A
 * self-hosted instance has one answer — everyone — and a hosted one reads a
 * subscriptions table the pipeline does not own. US-153 made the answer an
 * argument: the scheduler hands the gate every owner with a due monitor, once
 * per tick, and polls only for the owners it hands back.
 *
 * Three things the scheduler guarantees, whatever the gate does:
 *
 * 1. An owner the gate leaves out is never asked to poll. Not queued, not
 *    started, not billed.
 * 2. A gate that throws enqueues nothing. "Poll everybody while the
 *    subscriptions table is down" is the failure this file exists to prevent.
 * 3. The gate is called once per tick, with the whole set, so a gate that
 *    reads a table reads it once and not once per monitor.
 */

/** The owners that may poll, out of the ones handed in. */
export type EntitlementGate = (owners: ReadonlySet<string>) => Promise<ReadonlySet<string>>;

/**
 * The self-hosted answer, and the default. An instance that charges nobody
 * polls for everybody, which is what it did before any gate existed.
 */
export const admitEveryone: EntitlementGate = async (owners) => owners;
