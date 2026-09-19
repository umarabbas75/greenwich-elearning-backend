/**
 * Words that stay lowercase inside a title. They are still capitalised when
 * they open or close the title, so "Fire Safety in Practice" reads correctly
 * but "In Practice" never loses its leading capital.
 */
const MINOR_WORDS = new Set([
  'a',
  'an',
  'and',
  'as',
  'at',
  'but',
  'by',
  'for',
  'from',
  'in',
  'into',
  'nor',
  'of',
  'on',
  'onto',
  'or',
  'over',
  'the',
  'to',
  'up',
  'via',
  'with',
]);

/**
 * Title-case a learner or course name for the certificate face.
 * Short all-caps tokens (ISO, NEBOSH) and leading digits are preserved, and
 * minor words stay lowercase so course titles read as titles, not headlines.
 */
export function formatCertificateTitle(value: string): string {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';

  return words
    .map((word, index) => {
      const cased = word
        .split(/(-)/)
        .map((part) => titleCasePart(part))
        .join('');

      const isEdge = index === 0 || index === words.length - 1;
      if (!isEdge && MINOR_WORDS.has(word.toLowerCase())) {
        return word.toLowerCase();
      }
      return cased;
    })
    .join(' ');
}

function titleCasePart(part: string): string {
  if (!part || part === '-' || part === '&') return part;
  if (/^\d/.test(part)) return part;
  if (/^[A-Z0-9]{2,6}$/.test(part)) return part;

  if (part.includes("'") && part.length > 2) {
    return part
      .split("'")
      .map((piece) =>
        piece
          ? piece.charAt(0).toUpperCase() + piece.slice(1).toLowerCase()
          : piece,
      )
      .join("'");
  }

  return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
}
