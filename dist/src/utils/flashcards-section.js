"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildFlashcardsConfig = void 0;
const reject_inline_base64_1 = require("./reject-inline-base64");
const HTTP_URL = /^https?:\/\//i;
const DATA_URI = /^data:/i;
function normalizeLayout(layout) {
    if (layout == null) {
        return 'grid';
    }
    const trimmed = layout.trim();
    if (!trimmed) {
        return 'grid';
    }
    if (trimmed === 'grid' || trimmed === 'single') {
        return trimmed;
    }
    throw new Error('layout must be "grid" or "single"');
}
function normalizeImageUrl(imageUrl, label) {
    if (DATA_URI.test(imageUrl) || !HTTP_URL.test(imageUrl)) {
        throw new Error(`${label}.imageUrl must be an http or https URL`);
    }
    return imageUrl;
}
function normalizeFace(face, label) {
    const text = typeof face?.text === 'string' ? face.text.trim() : '';
    const imageUrl = typeof face?.imageUrl === 'string' ? face.imageUrl.trim() : '';
    if (!text && !imageUrl) {
        throw new Error(`${label} must have text and/or an image URL`);
    }
    if (text) {
        (0, reject_inline_base64_1.assertNoInlineBase64)(text, label);
    }
    return {
        text: text || null,
        imageUrl: imageUrl ? normalizeImageUrl(imageUrl, label) : null,
    };
}
function buildFlashcardsConfig(cards, layout) {
    if (!cards?.length) {
        throw new Error('FLASHCARDS sections require at least 1 card');
    }
    const ids = new Set();
    const normalized = cards.map((card, index) => {
        const id = typeof card?.id === 'string' ? card.id.trim() : '';
        if (!id) {
            throw new Error(`cards[${index}] must have a non-empty id`);
        }
        if (ids.has(id)) {
            throw new Error('Flashcards must have unique ids');
        }
        ids.add(id);
        return {
            id,
            front: normalizeFace(card.front, `cards[${index}].front`),
            back: normalizeFace(card.back, `cards[${index}].back`),
        };
    });
    return {
        layout: normalizeLayout(layout),
        cards: normalized,
    };
}
exports.buildFlashcardsConfig = buildFlashcardsConfig;
//# sourceMappingURL=flashcards-section.js.map