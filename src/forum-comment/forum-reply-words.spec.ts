import {
  assertForumReplyWordLimit,
  countForumReplyWords,
  FORUM_REPLY_MAX_WORDS,
} from './forum-reply-words';

describe('countForumReplyWords', () => {
  it('ignores HTML tags and counts visible words', () => {
    expect(
      countForumReplyWords('<p>Hello <strong>world</strong></p>'),
    ).toBe(2);
  });

  it('does not count images or empty markup', () => {
    expect(countForumReplyWords('<p><img src="x.jpg" /><br></p>')).toBe(0);
    expect(countForumReplyWords('<p>&nbsp;</p>')).toBe(0);
  });

  it('counts mention names, not the HTML wrapper', () => {
    expect(
      countForumReplyWords(
        '<p>Hi <span data-mention-user-id="abc">@Jane Doe</span></p>',
      ),
    ).toBe(3);
  });

  it('rejects replies over the cap', () => {
    const words = Array.from(
      { length: FORUM_REPLY_MAX_WORDS + 1 },
      (_, i) => `w${i}`,
    ).join(' ');
    expect(() => assertForumReplyWordLimit(`<p>${words}</p>`)).toThrow(
      `Replies can be at most ${FORUM_REPLY_MAX_WORDS} words`,
    );
  });
});
