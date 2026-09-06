import { parseAttachmentList, threadExcerpt } from './forum-extras';

describe('parseAttachmentList', () => {
  it('accepts pdf and docx', () => {
    expect(
      parseAttachmentList([
        {
          url: 'https://res.cloudinary.com/x/raw/upload/a.pdf',
          fileName: 'notes.pdf',
          mimeType: 'application/pdf',
          bytes: 1200,
        },
      ]),
    ).toEqual([
      {
        url: 'https://res.cloudinary.com/x/raw/upload/a.pdf',
        publicId: null,
        fileName: 'notes.pdf',
        mimeType: 'application/pdf',
        bytes: 1200,
      },
    ]);
  });

  it('infers mime from the file name when needed', () => {
    const [row] = parseAttachmentList([
      {
        url: 'https://cdn.example/doc.docx',
        fileName: 'brief.docx',
        mimeType: 'application/octet-stream',
      },
    ]);
    expect(row.mimeType).toContain('wordprocessingml');
  });

  it('rejects more than three files and unknown types', () => {
    expect(() =>
      parseAttachmentList([
        { url: 'a', fileName: 'a.pdf', mimeType: 'application/pdf' },
        { url: 'b', fileName: 'b.pdf', mimeType: 'application/pdf' },
        { url: 'c', fileName: 'c.pdf', mimeType: 'application/pdf' },
        { url: 'd', fileName: 'd.pdf', mimeType: 'application/pdf' },
      ]),
    ).toThrow(/At most 3/);
    expect(() =>
      parseAttachmentList([
        { url: 'https://x', fileName: 'photo.png', mimeType: 'image/png' },
      ]),
    ).toThrow(/PDF or DOCX/);
  });
});

describe('threadExcerpt', () => {
  it('strips markup and caps length', () => {
    expect(threadExcerpt('<p>Hello&nbsp;<strong>world</strong></p>')).toBe(
      'Hello world',
    );
    expect(threadExcerpt('a'.repeat(400)).length).toBe(280);
  });
});
