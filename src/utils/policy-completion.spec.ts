import { isPolicyComplete } from './policy-completion';

describe('isPolicyComplete', () => {
  it('trusts the acknowledgement row', () => {
    expect(isPolicyComplete(true, [{ applies: true, isComplete: false }])).toBe(
      true,
    );
  });

  it('is complete once every item that applies is acknowledged, even with no row', () => {
    expect(
      isPolicyComplete(false, [
        { applies: true, isComplete: true },
        // Added after the learner enrolled: not theirs to do.
        { applies: false, isComplete: false },
      ]),
    ).toBe(true);
  });

  it('is not complete while an item that applies is outstanding', () => {
    expect(
      isPolicyComplete(false, [
        { applies: true, isComplete: true },
        { applies: true, isComplete: false },
      ]),
    ).toBe(false);
  });

  it('counts every required item when none apply to the learner', () => {
    expect(
      isPolicyComplete(false, [
        { applies: false, isComplete: true },
        { applies: false, isComplete: false },
      ]),
    ).toBe(false);
  });

  it('has nothing to complete without required items', () => {
    expect(isPolicyComplete(false, [])).toBe(true);
  });
});
