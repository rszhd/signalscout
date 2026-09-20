/**
 * Fixtures for the words. US-270.
 *
 * A monitor row and a poll row as an API sends them, so a test of a sentence
 * does not have to write twenty fields to assert one. Shipped from the
 * package for the reason the words are: both applications' screen tests read
 * the same shapes, and two copies drift.
 *
 * Its own entry point, the way `@signalscout/pipeline/testing` is: nothing a
 * fixture knows belongs in a bundle a person downloads.
 */
export { monitor, poll, testMonitorId, testProjectId } from "./monitors.js";
