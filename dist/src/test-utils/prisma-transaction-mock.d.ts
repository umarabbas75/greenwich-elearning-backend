/// <reference types="jest" />
type AnyRecord = Record<string, any>;
export declare function makeAbortAwareTransactionMock(base: AnyRecord, opts?: {
    failOnCall?: number;
    failWith?: Error;
}): jest.Mock;
export declare const TRANSACTION_ABORT_MESSAGE = "current transaction is aborted, commands ignored until end of transaction block";
export {};
