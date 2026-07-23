/**
 * Shared Result envelope returned by every server action and lib function.
 *
 * Convention:
 * - On success: { success: true, data }
 * - On failure: { success: false, error: string, code?: string }
 *
 * Functions that return a Result MUST NOT throw. Callers branch on `success`.
 */
export type Result<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string };

export const ok = <T>(data: T): Result<T> => ({ success: true, data });
export const fail = <T = never>(error: string, code?: string): Result<T> => ({
  success: false,
  error,
  code,
});

/**
 * Reserved result code returned when an admin write loses an optimistic
 * lock race — i.e., the row's `updated_at` was advanced by someone else
 * (another admin, a webhook, a cron) between the time the page loaded
 * and the time this action's UPDATE ran.
 *
 * UI surfaces inspect `code === CONCURRENT_EDIT` to render a "reload
 * to see the current state" affordance instead of a generic error.
 */
export const CONCURRENT_EDIT = "CONCURRENT_EDIT" as const;

/**
 * Default Greek message for concurrent-edit failures. Server actions
 * SHOULD use this exact string so the UI can match on the message OR
 * the code; either works.
 */
export const CONCURRENT_EDIT_MESSAGE =
  "Η εγγραφή τροποποιήθηκε από άλλη ενέργεια ενώ ήταν ανοιχτή. Φορτώστε ξανά για να δείτε τις τρέχουσες τιμές.";

/** Convenience: standardized concurrent-edit failure. */
export const concurrentEdit = <T = never>(): Result<T> =>
  fail<T>(CONCURRENT_EDIT_MESSAGE, CONCURRENT_EDIT);
