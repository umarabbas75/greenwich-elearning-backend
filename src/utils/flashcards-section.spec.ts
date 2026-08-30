import { BadRequestException } from '@nestjs/common';
import { buildFlashcardsConfig } from './flashcards-section';

describe('buildFlashcardsConfig', () => {
  const fireCard = {
    id: 'card-fire',
    front: { text: 'Fire' },
    back: { text: 'A rapid oxidation process giving off heat and light.' },
  };
  const combustionCard = {
    id: 'card-combustion',
    front: { text: 'Combustion' },
    back: {
      text: 'The process of burning, where a material reacts with an oxidizer and gives off heat and gases.',
    },
  };

  it('normalizes cards and defaults layout to grid', () => {
    expect(buildFlashcardsConfig([fireCard, combustionCard])).toEqual({
      layout: 'grid',
      cards: [
        {
          id: 'card-fire',
          front: { text: 'Fire', imageUrl: null },
          back: {
            text: 'A rapid oxidation process giving off heat and light.',
            imageUrl: null,
          },
        },
        {
          id: 'card-combustion',
          front: { text: 'Combustion', imageUrl: null },
          back: {
            text: 'The process of burning, where a material reacts with an oxidizer and gives off heat and gases.',
            imageUrl: null,
          },
        },
      ],
    });
  });

  it('accepts single layout and image-only faces', () => {
    const config = buildFlashcardsConfig(
      [
        {
          id: 'card-1',
          front: { imageUrl: 'https://cdn.example.com/front.jpg' },
          back: {
            text: 'Definition',
            imageUrl: 'https://cdn.example.com/back.jpg',
          },
        },
      ],
      'single',
    );

    expect(config.layout).toBe('single');
    expect(config.cards[0].front).toEqual({
      text: null,
      imageUrl: 'https://cdn.example.com/front.jpg',
    });
  });

  it('trims layout and defaults omitted or blank layout to grid', () => {
    expect(buildFlashcardsConfig([fireCard], 'single ').layout).toBe('single');
    expect(buildFlashcardsConfig([fireCard]).layout).toBe('grid');
    expect(buildFlashcardsConfig([fireCard], '  ').layout).toBe('grid');
  });

  it('rejects unknown layout instead of coercing to grid', () => {
    expect(() => buildFlashcardsConfig([fireCard], 'carousel')).toThrow(
      'layout must be "grid" or "single"',
    );
    expect(() => buildFlashcardsConfig([fireCard], 'Single')).toThrow(
      'layout must be "grid" or "single"',
    );
  });

  it('rejects empty cards, missing id, and whitespace-only id', () => {
    expect(() => buildFlashcardsConfig([])).toThrow(
      'FLASHCARDS sections require at least 1 card',
    );
    expect(() => buildFlashcardsConfig(undefined)).toThrow(
      'FLASHCARDS sections require at least 1 card',
    );
    expect(() =>
      buildFlashcardsConfig([{ ...fireCard, id: undefined as any }]),
    ).toThrow('cards[0] must have a non-empty id');
    expect(() => buildFlashcardsConfig([{ ...fireCard, id: '   ' }])).toThrow(
      'cards[0] must have a non-empty id',
    );
  });

  it('rejects duplicate ids', () => {
    expect(() =>
      buildFlashcardsConfig([fireCard, { ...combustionCard, id: fireCard.id }]),
    ).toThrow('Flashcards must have unique ids');
  });

  it('rejects a face with neither text nor image', () => {
    expect(() =>
      buildFlashcardsConfig([
        { id: 'card-1', front: { text: 'Fire' }, back: {} },
      ]),
    ).toThrow('cards[0].back must have text and/or an image URL');
  });

  it('rejects non-http(s) and data-URI image URLs', () => {
    expect(() =>
      buildFlashcardsConfig([
        {
          id: 'card-1',
          front: { text: 'Fire' },
          back: { imageUrl: 'data:image/png;base64,abc' },
        },
      ]),
    ).toThrow('cards[0].back.imageUrl must be an http or https URL');

    expect(() =>
      buildFlashcardsConfig([
        {
          id: 'card-1',
          front: { text: 'Fire' },
          back: { imageUrl: 'DATA:IMAGE/PNG;BASE64,abc' },
        },
      ]),
    ).toThrow('cards[0].back.imageUrl must be an http or https URL');

    expect(() =>
      buildFlashcardsConfig([
        {
          id: 'card-1',
          front: { text: 'Fire' },
          back: { imageUrl: 'javascript:alert(1)' },
        },
      ]),
    ).toThrow('cards[0].back.imageUrl must be an http or https URL');

    expect(() =>
      buildFlashcardsConfig([
        {
          id: 'card-1',
          front: { text: 'Fire' },
          back: { imageUrl: '//cdn.example.com/back.jpg' },
        },
      ]),
    ).toThrow('cards[0].back.imageUrl must be an http or https URL');
  });

  it('rejects inline base64 in face text', () => {
    expect(() =>
      buildFlashcardsConfig([
        {
          id: 'card-1',
          front: { text: 'Fire' },
          back: { text: 'See data:image/png;base64,abc' },
        },
      ]),
    ).toThrow(BadRequestException);
  });

  it('re-validates an existing deck when only layout changes', () => {
    const stored = buildFlashcardsConfig([fireCard, combustionCard], 'grid');
    expect(buildFlashcardsConfig(stored.cards, 'single')).toEqual({
      ...stored,
      layout: 'single',
    });
  });

  it('re-validates when only cards change', () => {
    const stored = buildFlashcardsConfig([fireCard], 'single');
    expect(buildFlashcardsConfig([combustionCard], stored.layout)).toEqual({
      layout: 'single',
      cards: [
        {
          id: 'card-combustion',
          front: { text: 'Combustion', imageUrl: null },
          back: {
            text: 'The process of burning, where a material reacts with an oxidizer and gives off heat and gases.',
            imageUrl: null,
          },
        },
      ],
    });
  });
});
