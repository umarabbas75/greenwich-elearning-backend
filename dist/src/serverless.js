"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@nestjs/core");
const platform_express_1 = require("@nestjs/platform-express");
const express = require("express");
const app_module_1 = require("./app.module");
const app_setup_1 = require("./app.setup");
const expressApp = express();
let bootstrapPromise;
async function bootstrapApp() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule, new platform_express_1.ExpressAdapter(expressApp));
    (0, app_setup_1.configureApp)(app);
    await app.init();
}
async function handler(req, res) {
    if (!bootstrapPromise) {
        bootstrapPromise = bootstrapApp().catch((err) => {
            bootstrapPromise = undefined;
            throw err;
        });
    }
    await bootstrapPromise;
    return expressApp(req, res);
}
exports.default = handler;
//# sourceMappingURL=serverless.js.map