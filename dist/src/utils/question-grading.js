"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stripCorrectAnswerFields = exports.shuffleArray = exports.calculateAutoScore = exports.QUIZ_QUESTION_TYPES = void 0;
const client_1 = require("@prisma/client");
exports.QUIZ_QUESTION_TYPES = [
    client_1.QuestionType.SINGLE_CHOICE,
    client_1.QuestionType.MULTIPLE_CHOICE,
    client_1.QuestionType.TRUE_FALSE,
    client_1.QuestionType.FILL_IN_THE_BLANK,
    client_1.QuestionType.ORDERING,
    client_1.QuestionType.MATCHING,
    client_1.QuestionType.VISUAL_ACTIVITY,
];
function calculateAutoScore(type, content, answer, maxMarks) {
    if (!answer)
        return null;
    switch (type) {
        case client_1.QuestionType.SINGLE_CHOICE:
            return answer.selectedOptionId === content.correctOptionId ? maxMarks : 0;
        case client_1.QuestionType.TRUE_FALSE:
            return answer.answer === content.correctAnswer ? maxMarks : 0;
        case client_1.QuestionType.FILL_IN_THE_BLANK:
            return (answer.selectedWord ?? '').toLowerCase().trim() ===
                (content.correctAnswer ?? '').toLowerCase().trim()
                ? maxMarks
                : 0;
        case client_1.QuestionType.MULTIPLE_CHOICE: {
            const correct = new Set(content.correctOptionIds ?? []);
            const selected = new Set(answer.selectedOptionIds ?? []);
            const intersection = [...correct].filter((x) => selected.has(x)).length;
            const union = new Set([...correct, ...selected]).size;
            return union === 0 ? 0 : (intersection / union) * maxMarks;
        }
        case client_1.QuestionType.VISUAL_ACTIVITY: {
            const correct = new Set(content.options
                ?.filter((o) => o.isCorrect)
                .map((o) => o.id) ?? []);
            const selected = new Set(answer.selectedOptionIds ?? []);
            if (correct.size === 1 && !content.allowMultiple) {
                const [onlyCorrect] = correct;
                return selected.has(onlyCorrect) && selected.size === 1 ? maxMarks : 0;
            }
            const intersection = [...correct].filter((x) => selected.has(x)).length;
            const union = new Set([...correct, ...selected]).size;
            return union === 0 ? 0 : (intersection / union) * maxMarks;
        }
        case client_1.QuestionType.ORDERING: {
            const correct = content.correctOrder ?? [];
            const given = answer.orderedIds ?? [];
            const matches = correct.filter((id, idx) => given[idx] === id).length;
            return correct.length === 0 ? 0 : (matches / correct.length) * maxMarks;
        }
        case client_1.QuestionType.MATCHING: {
            const pairs = content.pairs ?? [];
            const givenPairs = answer.pairs ?? [];
            const correct = givenPairs.filter((gp) => gp.leftId === gp.rightId).length;
            return pairs.length === 0 ? 0 : (correct / pairs.length) * maxMarks;
        }
        case client_1.QuestionType.SHORT_ANSWER:
        case client_1.QuestionType.LONG_ANSWER:
            return null;
        default:
            return null;
    }
}
exports.calculateAutoScore = calculateAutoScore;
function shuffleArray(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}
exports.shuffleArray = shuffleArray;
function stripCorrectAnswerFields(content) {
    if (!content)
        return content;
    const sanitized = { ...content };
    delete sanitized.correctOptionId;
    delete sanitized.correctOptionIds;
    delete sanitized.correctAnswer;
    delete sanitized.correctOrder;
    if (sanitized.pairs) {
        const categories = shuffleArray(sanitized.pairs.map((p) => ({ id: p.id, text: p.right })));
        sanitized.categories = categories;
        sanitized.pairs = sanitized.pairs.map((p) => ({
            id: p.id,
            left: p.left,
        }));
    }
    if (sanitized.options) {
        sanitized.options = sanitized.options.map((o) => ({
            id: o.id,
            text: o.text,
        }));
    }
    return sanitized;
}
exports.stripCorrectAnswerFields = stripCorrectAnswerFields;
//# sourceMappingURL=question-grading.js.map