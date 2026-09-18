/**
 * The two models this product runs, named once.
 *
 * Every capture writes a file per model, so an experiment with a new model
 * never overwrites the evidence for the one in production. The tests have to
 * read *some* file, and these names say which: the pair the product actually
 * sends, not the newest pair somebody tried.
 *
 * **Changing a name here is a promotion, and it is the last step, not the
 * first.** Capture the new model, read whether the leads survived, put the
 * numbers in a ticket, change the environment, and only then change this. The
 * suite will go red until the matching fixture exists, which is the point: a
 * pinned model with no recorded evidence is a claim nobody has checked.
 */

/** The model in front of the classifier. `AI_TRIAGE_MODEL`. */
export const pinnedTriageModel = "gpt-5.6-luna";

/** The model that scores. `AI_MODEL` in the hosted application. */
export const pinnedClassifierModel = "gpt-5.6-luna";
