/**
 * How many pages one input may buy in one request's poll. US-435.
 *
 * Every paging connector has its own cap, sized for a monitor that polls
 * often with a window. A caller may ask for another count on a request —
 * the pipeline does, for a monitor's first poll, when it is told to — and
 * this is the one place that says what a connector does with the ask.
 *
 * Absent means the connector's own cap. A count outside 1 to
 * `maximumPagesPerInput` is a caller's mistake and throws: silently using
 * the default would hide it, and silently honouring 500 would bill it.
 */
import type { SearchRequest } from "./types.js";

export const maximumPagesPerInput = 20;

export function pagesPerInputFor(
  request: Pick<SearchRequest, "pagesPerInput">,
  connectorCap: number,
): number {
  const asked = request.pagesPerInput;
  if (asked === undefined) return connectorCap;
  if (!Number.isInteger(asked) || asked < 1 || asked > maximumPagesPerInput) {
    throw new RangeError(
      `pagesPerInput must be a whole number from 1 to ${maximumPagesPerInput}, not ${asked}`,
    );
  }
  return asked;
}
