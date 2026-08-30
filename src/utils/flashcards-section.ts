import { assertNoInlineBase64 } from './reject-inline-base64';

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

const HTTP_URL = /^https?:\/\//i;
const DATA_URI = /^data:/i;

function normalizeLayout(layout?: string | null): FlashcardLayoutValue {
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

function normalizeImageUrl(imageUrl: string, label: string): string {
  if (DATA_URI.test(imageUrl) || !HTTP_URL.test(imageUrl)) {
    throw new Error(`${label}.imageUrl must be an http or https URL`);
  }
  return imageUrl;
}

function normalizeFace(
  face: FaceInput | undefined,
  label: string,
): FlashcardFace {
  const text = typeof face?.text === 'string' ? face.text.trim() : '';
  const imageUrl =
    typeof face?.imageUrl === 'string' ? face.imageUrl.trim() : '';

  if (!text && !imageUrl) {
    throw new Error(`${label} must have text and/or an image URL`);
  }

  if (text) {
    assertNoInlineBase64(text, label);
  }

  return {
    text: text || null,
    imageUrl: imageUrl ? normalizeImageUrl(imageUrl, label) : null,
  };
}

export function buildFlashcardsConfig(
  cards: CardInput[] | undefined,
  layout?: string | null,
): FlashcardsConfig {
  if (!cards?.length) {
    throw new Error('FLASHCARDS sections require at least 1 card');
  }

  const ids = new Set<string>();
  const normalized: Flashcard[] = cards.map((card, index) => {
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
