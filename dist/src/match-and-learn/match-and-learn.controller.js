"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MatchAndLearnController = void 0;
const common_1 = require("@nestjs/common");
const match_and_learn_service_1 = require("./match-and-learn.service");
const dto_1 = require("../dto");
let MatchAndLearnController = class MatchAndLearnController {
    constructor(matchAndLearnService) {
        this.matchAndLearnService = matchAndLearnService;
    }
    async createMatchAndLearn(body) {
        return this.matchAndLearnService.createMatchAndLearn(body);
    }
    async getAllMatchAndLearn(chapterId) {
        return this.matchAndLearnService.getAllMatchAndLearn(chapterId);
    }
    async getMatchAndLearnById(id) {
        return this.matchAndLearnService.getMatchAndLearnById(id);
    }
    async updateMatchAndLearn(id, body) {
        return this.matchAndLearnService.updateMatchAndLearn(id, body);
    }
    async deleteMatchAndLearn(id) {
        return this.matchAndLearnService.deleteMatchAndLearn(id);
    }
    async submitMatchAndLearnCompletion(matchAndLearnId, body) {
        return this.matchAndLearnService.submitMatchAndLearnCompletion(body.userId, matchAndLearnId, body.chapterId, body.userAnswers);
    }
    async getUserProgress(userId, chapterId) {
        return this.matchAndLearnService.getUserProgress(userId, chapterId);
    }
};
exports.MatchAndLearnController = MatchAndLearnController;
__decorate([
    (0, common_1.Post)(),
    (0, common_1.HttpCode)(common_1.HttpStatus.CREATED),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.MatchAndLearnDto]),
    __metadata("design:returntype", Promise)
], MatchAndLearnController.prototype, "createMatchAndLearn", null);
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Query)('chapterId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], MatchAndLearnController.prototype, "getAllMatchAndLearn", null);
__decorate([
    (0, common_1.Get)(':id'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], MatchAndLearnController.prototype, "getMatchAndLearnById", null);
__decorate([
    (0, common_1.Put)(':id'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, dto_1.UpdateMatchAndLearnDto]),
    __metadata("design:returntype", Promise)
], MatchAndLearnController.prototype, "updateMatchAndLearn", null);
__decorate([
    (0, common_1.Delete)(':id'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], MatchAndLearnController.prototype, "deleteMatchAndLearn", null);
__decorate([
    (0, common_1.Post)(':id/submit'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], MatchAndLearnController.prototype, "submitMatchAndLearnCompletion", null);
__decorate([
    (0, common_1.Get)('progress/:userId'),
    __param(0, (0, common_1.Param)('userId')),
    __param(1, (0, common_1.Query)('chapterId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], MatchAndLearnController.prototype, "getUserProgress", null);
exports.MatchAndLearnController = MatchAndLearnController = __decorate([
    (0, common_1.Controller)('match-and-learn'),
    __metadata("design:paramtypes", [match_and_learn_service_1.MatchAndLearnService])
], MatchAndLearnController);
//# sourceMappingURL=match-and-learn.controller.js.map