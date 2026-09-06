import { parseMentionedUserIds } from './forum-mentions';

describe('parseMentionedUserIds', () => {
  const a = '11111111-1111-4111-8111-111111111111';
  const b = '22222222-2222-4222-8222-222222222222';

  it('reads data-mention-user-id attributes', () => {
    const html = `<p>Hey <span data-mention-user-id="${a}">@Ali</span></p>`;
    expect(parseMentionedUserIds(html)).toEqual([a]);
  });

  it('reads markdown @[Name](uuid) tokens', () => {
    expect(parseMentionedUserIds(`Hello @[Ali Hasan](${b})`)).toEqual([b]);
  });

  it('dedupes and ignores junk', () => {
    const html = `@[Ali](${a}) <span data-mention-user-id="${a}">@Ali</span> @[Nope](not-an-id)`;
    expect(parseMentionedUserIds(html)).toEqual([a]);
  });

  it('returns empty for blank content', () => {
    expect(parseMentionedUserIds('')).toEqual([]);
    expect(parseMentionedUserIds(null)).toEqual([]);
  });
});
