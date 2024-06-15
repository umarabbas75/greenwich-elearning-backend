"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.drive = exports.auth = void 0;
const googleapis_1 = require("googleapis");
const path = require("path");
const KEYFILEPATH = path.join(__dirname, './client_secret.json');
const SCOPES = ['https://www.googleapis.com/auth/drive'];
exports.auth = new googleapis_1.google.auth.GoogleAuth({
    keyFile: KEYFILEPATH,
    scopes: SCOPES,
});
exports.drive = googleapis_1.google.drive({
    version: 'v3',
    auth: exports.auth,
});
//# sourceMappingURL=google.config.js.map