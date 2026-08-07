import { BadRequestException } from '@nestjs/common';
import { assertNoInlineBase64 } from './reject-inline-base64';

describe('assertNoInlineBase64', () => {
  it('allows normal HTML', () => {
    expect(() =>
      assertNoInlineBase64('<p>Hello <strong>world</strong></p>'),
    ).not.toThrow();
  });

  it('allows images referenced by URL', () => {
    expect(() =>
      assertNoInlineBase64(
        '<img src="https://res.cloudinary.com/dp9urvlsz/image/upload/v1/my_uploads/x.png" />',
      ),
    ).not.toThrow();
  });

  it('allows null/undefined/empty', () => {
    expect(() => assertNoInlineBase64(null)).not.toThrow();
    expect(() => assertNoInlineBase64(undefined)).not.toThrow();
    expect(() => assertNoInlineBase64('')).not.toThrow();
  });

  it('rejects inline base64 png', () => {
    expect(() =>
      assertNoInlineBase64('<img src="data:image/png;base64,iVBORw0KGgo=" />'),
    ).toThrow(BadRequestException);
  });

  it('rejects other inline image mime types', () => {
    for (const mime of [
      'image/jpeg',
      'image/gif',
      'image/svg+xml',
      'image/webp',
    ]) {
      expect(() =>
        assertNoInlineBase64(`<img src="data:${mime};base64,AAAA" />`),
      ).toThrow(BadRequestException);
    }
  });

  it('rejects oversized HTML even without a data URI', () => {
    expect(() => assertNoInlineBase64('a'.repeat(600 * 1024))).toThrow(
      BadRequestException,
    );
  });

  it('names the offending field in the message', () => {
    expect(() =>
      assertNoInlineBase64('data:image/png;base64,AAAA', 'shortDescription'),
    ).toThrow(/shortDescription/);
  });

  it('allows the short HTML snippets shortDescription actually holds', () => {
    expect(() =>
      assertNoInlineBase64('<p>A brief summary</p>', 'shortDescription'),
    ).not.toThrow();
  });

  it('does not block non-image data URIs (out of scope)', () => {
    expect(() =>
      assertNoInlineBase64('<a href="data:text/plain;base64,AAAA">x</a>'),
    ).not.toThrow();
  });
});
