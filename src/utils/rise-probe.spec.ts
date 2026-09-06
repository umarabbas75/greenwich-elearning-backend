import { readFileSync } from 'fs';
import { join } from 'path';
import { parseRiseRuntimeData, unescapeRiseTitle } from './rise-probe';

function loadFixture(name: string): string {
  return readFileSync(join(__dirname, 'fixtures', name), 'utf8');
}

describe('parseRiseRuntimeData', () => {
  it('unwraps JSONP + base64 and reports lifting: passed-incomplete, empty quiz', () => {
    const probe = parseRiseRuntimeData(loadFixture('rise-runtime-lifting.js'));
    expect(probe.reporting).toBe('passed-incomplete');
    expect(probe.quizItemCount).toBe(0);
    expect(probe.passingScore).toBeNull();
    expect(probe.title).toContain('Safe Lifting');
    expect(probe.title).toContain('&amp;');
  });

  it('counts fire-safety quiz items and reads passingScore from quiz.settings', () => {
    const probe = parseRiseRuntimeData(
      loadFixture('rise-runtime-fire-safety.js'),
    );
    expect(probe.reporting).toBe('passed-incomplete');
    expect(probe.quizItemCount).toBe(25);
    expect(probe.passingScore).toBe(80);
    expect(probe.title).toContain('Fire Safety');
  });

  it('unescapes a double-encoded Rise title twice', () => {
    expect(
      unescapeRiseTitle(
        'Occupational Health &amp;amp; Safety: Safe Lifting',
      ),
    ).toBe('Occupational Health & Safety: Safe Lifting');
    expect(
      unescapeRiseTitle('Occupational Health &amp; Safety: Safe Lifting'),
    ).toBe('Occupational Health & Safety: Safe Lifting');
  });
});
