"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.configureApp = exports.CORS_ORIGINS = void 0;
const common_1 = require("@nestjs/common");
const bodyParser = require("body-parser");
exports.CORS_ORIGINS = [
    'https://greenwich-elearning.vercel.app',
    'https://greenwich-elearning.vercel.app/user',
    'https://www.greenwichtc-elearning.com',
    'https://greenwichtc-elearning.com',
    'https://www.greenwichtc-elearning.com/',
    'http://localhost:3001',
    'http://localhost:3000',
];
function configureApp(app) {
    app.enableCors({
        origin: exports.CORS_ORIGINS,
        methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
        credentials: true,
    });
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new common_1.ValidationPipe({
        whitelist: true,
    }));
    app.use(bodyParser.json({ limit: '50mb' }));
    app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
    return app;
}
exports.configureApp = configureApp;
//# sourceMappingURL=app.setup.js.map