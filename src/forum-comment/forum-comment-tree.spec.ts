import { nestForumComments } from './forum-comment-tree';

describe('nestForumComments', () => {
  const a = {
    id: 'a',
    parentId: null,
    createdAt: '2026-01-02',
    voteScore: 1,
    isAccepted: false,
  };
  const b = {
    id: 'b',
    parentId: null,
    createdAt: '2026-01-01',
    voteScore: 5,
    isAccepted: false,
  };
  const a1 = {
    id: 'a1',
    parentId: 'a',
    createdAt: '2026-01-03',
    voteScore: 0,
    isAccepted: false,
  };
  const a0 = {
    id: 'a0',
    parentId: 'a',
    createdAt: '2026-01-02T12:00:00.000Z',
    voteScore: 9,
    isAccepted: false,
  };

  it('nests one level and keeps child order chronological', () => {
    const nested = nestForumComments([a1, b, a, a0], 'top');
    expect(nested.map((row) => row.id)).toEqual(['b', 'a']);
    expect(nested[1].replies.map((row) => row.id)).toEqual(['a0', 'a1']);
  });

  it('promotes orphan nested rows so nothing is dropped', () => {
    const nested = nestForumComments([a, a1, { ...a0, parentId: 'missing' }], 'latest');
    expect(nested.map((row) => row.id).sort()).toEqual(['a', 'a0']);
    expect(nested.find((row) => row.id === 'a')?.replies.map((row) => row.id)).toEqual(['a1']);
  });
});
