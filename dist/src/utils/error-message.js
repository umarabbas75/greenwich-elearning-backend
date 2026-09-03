"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorMessage = void 0;
function errorMessage(err) {
    if (err instanceof Error)
        return err.message;
    return String(err);
}
exports.errorMessage = errorMessage;
//# sourceMappingURL=error-message.js.map