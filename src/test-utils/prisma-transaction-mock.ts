/**
 * Test helper: a `$transaction` mock that reproduces real Postgres interactive
 * transaction semantics.
 *
 * The pass-through mock every spec used before —
 *
 *   $transaction: jest.fn(async (cb) => cb(prisma))
 *
 * — models a transaction that cannot fail. Under it, a statement that throws
 * inside the callback and is then caught looks completely harmless. Real
 * Postgres does not behave that way: once ANY statement inside an interactive
 * transaction errors, the transaction enters an aborted state and every
 * subsequent statement — including COMMIT — fails with
 *
 *   "current transaction is aborted, commands ignored until end of
 *    transaction block"
 *
 * That gap hid a production bug where an audit insert failing inside a
 * migration transaction silently rolled back the migration, because the code
 * caught the audit error and assumed the surrounding work would still commit.
 *
 * This mock makes that class of bug fail loudly in tests:
 *   - a rejected model call marks the tx aborted,
 *   - every later model call on the tx client rejects with the Postgres abort
 *     message (even if the callback swallowed the original error),
 *   - and commit rejects, so the whole `$transaction` call rejects.
 *
 * Usage:
 *
 *   prisma.$transaction = makeAbortAwareTransactionMock(prisma);
 *
 * Pass `{ failOnCall }` to inject a failure at the Nth interactive tx (1-based)
 * without hand-rolling a mockImplementation — useful for "one wedged learner in
 * a batch" cases.
 */

type AnyRecord = Record<string, any>;

const ABORT_MESSAGE =
  'current transaction is aborted, commands ignored until end of transaction block';

/**
 * Wrap a prisma-like mock so every model method observes the aborted flag.
 * Only plain objects whose values include jest mock functions are wrapped, so
 * non-model keys (`$queryRaw`, `$transaction`, …) pass through untouched.
 */
function wrapClient(
  base: AnyRecord,
  isAborted: () => boolean,
  abort: () => void,
): AnyRecord {
  const proxied: AnyRecord = {};

  for (const [modelName, model] of Object.entries(base)) {
    if (
      !model ||
      typeof model !== 'object' ||
      Array.isArray(model) ||
      modelName.startsWith('$')
    ) {
      proxied[modelName] = model;
      continue;
    }

    const wrappedModel: AnyRecord = {};
    for (const [methodName, method] of Object.entries(model as AnyRecord)) {
      if (typeof method !== 'function') {
        wrappedModel[methodName] = method;
        continue;
      }
      wrappedModel[methodName] = async (...args: unknown[]) => {
        if (isAborted()) {
          throw new Error(ABORT_MESSAGE);
        }
        try {
          return await (method as (...a: unknown[]) => unknown)(...args);
        } catch (err) {
          // A failed statement poisons the transaction, exactly as Postgres
          // does — even if the caller catches this rejection.
          abort();
          throw err;
        }
      };
    }
    proxied[modelName] = wrappedModel;
  }

  return proxied;
}

export function makeAbortAwareTransactionMock(
  base: AnyRecord,
  opts: { failOnCall?: number; failWith?: Error } = {},
): jest.Mock {
  let callCount = 0;

  return jest.fn(async (arg: unknown) => {
    // Array form ($transaction([...])) has no interactive callback and no
    // abort semantics to model — resolve them like Prisma does.
    if (Array.isArray(arg)) {
      return Promise.all(arg);
    }

    callCount += 1;
    if (opts.failOnCall && callCount === opts.failOnCall) {
      throw (
        opts.failWith ??
        new Error('P2034: Transaction failed due to a write conflict')
      );
    }

    let aborted = false;
    const txClient = wrapClient(
      base,
      () => aborted,
      () => {
        aborted = true;
      },
    );

    const result = await (arg as (tx: AnyRecord) => Promise<unknown>)(txClient);

    // COMMIT is itself a statement: an aborted transaction rolls back here,
    // no matter what the callback returned.
    if (aborted) {
      throw new Error(`ROLLBACK: ${ABORT_MESSAGE}`);
    }
    return result;
  });
}

export const TRANSACTION_ABORT_MESSAGE = ABORT_MESSAGE;
