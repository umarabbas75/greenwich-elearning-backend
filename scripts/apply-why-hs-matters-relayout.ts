/**
 * One-off: relayout Element 1.1 main lesson (TipTap) for richer structure.
 * Preserves original text nodes; run with --apply to write to DB.
 *
 *   yarn ts-node -r tsconfig-paths/register scripts/apply-why-hs-matters-relayout.ts
 *   yarn ts-node -r tsconfig-paths/register scripts/apply-why-hs-matters-relayout.ts --apply
 */
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';

dotenv.config();

const SECTION_ID = '420216c7-aa99-4d5b-a9c2-2e73abe5ba06';
const BACKUP_FILE = path.join(
  process.cwd(),
  'backups/section-content',
  '420216c7-aa99-4d5b-a9c2-2e73abe5ba06_why-health-and-safety-matters_2026-10-03.json',
);

const GREEN = '#4f7a28';

type TipTapNode = Record<string, unknown>;

const rawUrl = process.env.DATABASE_URL ?? '';
const datasourceUrl = rawUrl.includes('pgbouncer=true')
  ? rawUrl
  : rawUrl + (rawUrl.includes('?') ? '&' : '?') + 'pgbouncer=true&connect_timeout=30';

const prisma = new PrismaClient({ datasources: { db: { url: datasourceUrl } } });

function clone<T>(n: T): T {
  return JSON.parse(JSON.stringify(n)) as T;
}

function slice(content: TipTapNode[], from: number, to: number): TipTapNode[] {
  return clone(content.slice(from, to + 1)).filter((n) => {
    if (n.type !== 'paragraph') return true;
    const c = n.content as { text?: string }[] | undefined;
    if (!c?.length) return false;
    const text = c.map((x) => x.text ?? '').join('');
    return text.trim().length > 0;
  });
}

function h2(text: string): TipTapNode {
  return {
    type: 'heading',
    attrs: { textAlign: null, level: 2 },
    content: [
      {
        type: 'text',
        marks: [
          { type: 'textStyle', attrs: { fontSize: null, color: GREEN } },
          { type: 'bold' },
        ],
        text,
      },
    ],
  };
}

function h3(text: string): TipTapNode {
  return {
    type: 'heading',
    attrs: { textAlign: null, level: 3 },
    content: [
      {
        type: 'text',
        marks: [
          { type: 'textStyle', attrs: { fontSize: null, color: GREEN } },
          { type: 'bold' },
        ],
        text: text.trim(),
      },
    ],
  };
}

function hr(): TipTapNode {
  return { type: 'horizontalRule' };
}

function callout(variant: string, inner: TipTapNode[]): TipTapNode {
  return { type: 'callout', attrs: { variant }, content: inner };
}

function columns(count: number, cols: TipTapNode[][]): TipTapNode {
  return {
    type: 'columns',
    attrs: { count },
    content: cols.map((col) => ({ type: 'column', content: col })),
  };
}

function tabs(items: { title: string; content: TipTapNode[] }[]): TipTapNode {
  return {
    type: 'tabs',
    content: items.map((item) => ({
      type: 'tabItem',
      attrs: { title: item.title },
      content: item.content,
    })),
  };
}

function accordion(items: { title: string; content: TipTapNode[] }[]): TipTapNode {
  return {
    type: 'accordion',
    content: items.map((item) => ({
      type: 'accordionItem',
      attrs: { title: item.title },
      content: item.content,
    })),
  };
}

function detailsFromNode(node: TipTapNode, open = false): TipTapNode {
  return { ...clone(node), attrs: { open } };
}

function detailsBody(node: TipTapNode): TipTapNode[] {
  const parts = node.content as TipTapNode[];
  const body = parts.find((p) => p.type === 'detailsContent');
  return body ? clone(body.content as TipTapNode[]) : [];
}

function rememberCallout(node: TipTapNode): TipTapNode {
  const summary = (node.content as TipTapNode[]).find((p) => p.type === 'detailsSummary');
  const label =
    summary &&
    ((summary.content as { text?: string }[] | undefined)?.map((x) => x.text).join('') ||
      'REMEMBER');
  return callout('success', [
    {
      type: 'paragraph',
      attrs: { textAlign: null },
      content: [
        {
          type: 'text',
          marks: [
            { type: 'textStyle', attrs: { fontSize: null, color: GREEN } },
            { type: 'bold' },
          ],
          text: label.trim(),
        },
      ],
    },
    ...detailsBody(node),
  ]);
}

function collectFlashcards(content: TipTapNode[], indices: number[]): TipTapNode[] {
  const cards: unknown[] = [];
  for (const i of indices) {
    const n = content[i];
    if (n?.type === 'flashcards' && (n.attrs as { cards?: unknown[] })?.cards) {
      cards.push(...((n.attrs as { cards: unknown[] }).cards));
    }
  }
  return cards as TipTapNode[];
}

function flashcardsGrid(cards: unknown[]): TipTapNode {
  return { type: 'flashcards', attrs: { layout: 'grid', cards } };
}

function paraText(n: TipTapNode): string {
  if (n.type !== 'paragraph') return '';
  const c = n.content as { text?: string }[] | undefined;
  return (c ?? []).map((x) => x.text ?? '').join('').trim();
}

function buildRelayoutedDoc(original: TipTapNode[]): TipTapNode[] {
  const c = original;
  const keyTermCards = collectFlashcards(c, [14, 18, 24, 30, 37, 44, 50, 102]);

  const studyQuestions = (c[132] as TipTapNode).content as TipTapNode[];
  const studyAccordion = accordion(
    studyQuestions.map((item, idx) => ({
      title: `Question ${idx + 1}`,
      content: clone((item as TipTapNode).content as TipTapNode[]),
    })),
  );

  const moralTab = [
    h3(paraText(c[68])),
    ...slice(c, 69, 78),
  ];
  const legalTab = [h3(paraText(c[80])), ...slice(c, 81, 84)];
  const financialTab = [h3(paraText(c[86])), ...slice(c, 87, 90), clone(c[88])];

  return [
    h2('Introduction'),
    hr(),
    callout('success', [clone(c[6])]),
    ...slice(c, 3, 5),

    h2('What occupational health and safety means'),
    hr(),
    columns(2, [
      [...slice(c, 11, 12), flashcardsGrid(keyTermCards.slice(0, 1))],
      [clone(c[13])],
    ]),
    ...slice(c, 15, 15),

    h2('Key terms in depth'),
    hr(),
    flashcardsGrid(keyTermCards),
    accordion([
      {
        title: 'Health',
        content: slice(c, 19, 21),
      },
      {
        title: 'Safety',
        content: [...slice(c, 25, 27), clone(c[28])],
      },
      {
        title: 'Welfare',
        content: [clone(c[31]), ...slice(c, 32, 32), clone(c[33]), ...slice(c, 34, 34)],
      },
      {
        title: 'Accident',
        content: [...slice(c, 38, 41), clone(c[42])],
      },
      {
        title: 'Near miss',
        content: [...slice(c, 45, 45), clone(c[46]), ...slice(c, 47, 47)],
      },
      {
        title: 'Work-related ill health',
        content: [...slice(c, 51, 53), clone(c[54]), ...slice(c, 55, 55)],
      },
    ]),

    h2('Putting the key terms together'),
    hr(),
    ...slice(c, 58, 58),
    clone(c[59]),
    rememberCallout(c[60]),

    h2('Why health and safety is managed'),
    hr(),
    ...slice(c, 65, 66),
    tabs([
      { title: 'Moral', content: moralTab },
      { title: 'Legal', content: legalTab },
      { title: 'Financial', content: financialTab },
    ]),
    h3('How the three reasons fit together'),
    ...slice(c, 93, 93),
    rememberCallout(c[94]),

    h2('Health and safety law around the world'),
    hr(),
    ...slice(c, 99, 100),
    flashcardsGrid(keyTermCards.slice(-1)),
    accordion([
      {
        title: 'What can differ between countries',
        content: [...slice(c, 105, 105), clone(c[106]), ...slice(c, 107, 107)],
      },
      {
        title: 'Shared international principles (ILO)',
        content: slice(c, 110, 112),
      },
      {
        title: 'From international principles to your workplace',
        content: [...slice(c, 115, 115), clone(c[116]), ...slice(c, 117, 118)],
      },
      {
        title: 'What this means for you',
        content: [
          ...slice(c, 121, 121),
          detailsFromNode(c[122], false),
        ],
      },
    ]),

    h2('Element summary'),
    hr(),
    {
      type: 'blockquote',
      content: [
        ...((c[124] as TipTapNode).content as TipTapNode[]).filter((n) => n.type !== 'horizontalRule'),
        ...slice(c, 125, 127),
      ],
    },

    h2('Study questions'),
    hr(),
    studyAccordion,

    h2('Further reading and resources'),
    hr(),
    clone(c[137]),
  ];
}

async function main() {
  if (!fs.existsSync(BACKUP_FILE)) {
    throw new Error(`Backup not found: ${BACKUP_FILE}`);
  }

  const backup = JSON.parse(fs.readFileSync(BACKUP_FILE, 'utf8')) as {
    section: { description: string; shortDescription: string | null };
  };
  const envelope = JSON.parse(backup.section.description) as {
    __greenwichEditor: string;
    v: number;
    doc: TipTapNode;
    html?: string;
  };

  const originalContent = envelope.doc.content as TipTapNode[];
  const newContent = buildRelayoutedDoc(originalContent);
  const newEnvelope = {
    ...envelope,
    doc: { type: 'doc', content: newContent },
    // Learner renders from `doc`; html refreshed on next admin save.
    html: envelope.html,
  };

  const description = JSON.stringify(newEnvelope);
  const shortDescription =
    '<p><strong>Introduction</strong></p><p>Every workplace has things that can hurt people. In a kitchen there are sharp knives and hot surfaces. In an office there are trailing cables and long hours at a screen. On a farm there are machines, animals and chemicals. On a building site there are heights, vehicles and heavy materials.</p>';

  const outPath = path.join(
    process.cwd(),
    'backups/section-content',
    `${SECTION_ID}_relayout-preview.json`,
  );
  fs.writeFileSync(
    outPath,
    JSON.stringify({ description, shortDescription }, null, 2),
  );
  console.log('Preview written:', outPath);
  console.log('New description length:', description.length);

  if (!process.argv.includes('--apply')) {
    console.log('Dry run — pass --apply to update the database.');
    return;
  }

  await prisma.section.update({
    where: { id: SECTION_ID },
    data: { description, shortDescription },
  });
  console.log('Updated section', SECTION_ID);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
