export type FlashcardLayoutValue = 'grid' | 'single';
export type FlashcardFace = {
    text: string | null;
    imageUrl: string | null;
};
export type Flashcard = {
    id: string;
    front: FlashcardFace;
    back: FlashcardFace;
};
export type FlashcardsConfig = {
    layout: FlashcardLayoutValue;
    cards: Flashcard[];
};
type FaceInput = {
    text?: string | null;
    imageUrl?: string | null;
};
type CardInput = {
    id?: string;
    front?: FaceInput;
    back?: FaceInput;
};
export declare function buildFlashcardsConfig(cards: CardInput[] | undefined, layout?: string | null): FlashcardsConfig;
export {};
