import { coursePoliciesSignature } from './course-policy-signature';

describe('coursePoliciesSignature', () => {
  const stored = [
    {
      id: 'p1',
      courseId: 'c1',
      title: 'NEBOSH Policies and Procedures',
      description: null,
      order: 0,
      createdAt: new Date(),
      items: [
        { id: 'i2', title: 'Appeals', description: '', link: 'https://b', isRequired: true, order: 1 },
        { id: 'i1', title: 'Complaints', description: '', link: 'https://a', isRequired: true, order: 0 },
      ],
    },
  ];

  it('matches the same policies sent back by the edit form', () => {
    const incoming = [
      {
        title: 'NEBOSH Policies and Procedures',
        items: [
          { title: 'Complaints', link: 'https://a', isRequired: true, order: 0 },
          { title: 'Appeals', link: 'https://b', isRequired: true, order: 1 },
        ],
      },
    ];
    expect(coursePoliciesSignature(incoming)).toBe(coursePoliciesSignature(stored));
  });

  it('detects a changed item link', () => {
    const incoming = [
      {
        ...stored[0],
        items: [{ ...stored[0].items[0], link: 'https://changed' }, stored[0].items[1]],
      },
    ];
    expect(coursePoliciesSignature(incoming)).not.toBe(coursePoliciesSignature(stored));
  });

  it('detects an added policy', () => {
    const incoming = [...stored, { title: 'New policy', items: [] }];
    expect(coursePoliciesSignature(incoming)).not.toBe(coursePoliciesSignature(stored));
  });
});
