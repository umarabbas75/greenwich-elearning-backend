"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TRANSACTION_ABORT_MESSAGE = exports.makeAbortAwareTransactionMock = void 0;
const ABORT_MESSAGE = 'current transaction is aborted, commands ignored until end of transaction block';
function wrapClient(base, isAborted, abort) {
    const proxied = {};
    for (const [modelName, model] of Object.entries(base)) {
        if (!model ||
            typeof model !== 'object' ||
            Array.isArray(model) ||
            modelName.startsWith('$')) {
            proxied[modelName] = model;
            continue;
        }
        const wrappedModel = {};
        for (const [methodName, method] of Object.entries(model)) {
            if (typeof method !== 'function') {
                wrappedModel[methodName] = method;
                continue;
            }
            wrappedModel[methodName] = async (...args) => {
                if (isAborted()) {
                    throw new Error(ABORT_MESSAGE);
                }
                try {
                    return await method(...args);
                }
                catch (err) {
                    abort();
                    throw err;
                }
            };
        }
        proxied[modelName] = wrappedModel;
    }
    return proxied;
}
function makeAbortAwareTransactionMock(base, opts = {}) {
    let callCount = 0;
    return jest.fn(async (arg) => {
        if (Array.isArray(arg)) {
            return Promise.all(arg);
        }
        callCount += 1;
        if (opts.failOnCall && callCount === opts.failOnCall) {
            throw (opts.failWith ??
                new Error('P2034: Transaction failed due to a write conflict'));
        }
        let aborted = false;
        const txClient = wrapClient(base, () => aborted, () => {
            aborted = true;
        });
        const result = await arg(txClient);
        if (aborted) {
            throw new Error(`ROLLBACK: ${ABORT_MESSAGE}`);
        }
        return result;
    });
}
exports.makeAbortAwareTransactionMock = makeAbortAwareTransactionMock;
exports.TRANSACTION_ABORT_MESSAGE = ABORT_MESSAGE;
//# sourceMappingURL=prisma-transaction-mock.js.map