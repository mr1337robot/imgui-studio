import { describe, expect, it } from 'vitest';
import { applyUnifiedDiff } from '../../../apps/studio-service/src/unified-diff.ts';

describe('strict unified diff application', () => {
  it('applies context, removal, and addition hunks without touching unrelated lines', () => {
    const source = 'alpha\nbeta\ngamma\ndelta\n';
    const patch = [
      '--- a/sample.cpp',
      '+++ b/sample.cpp',
      '@@ -1,4 +1,4 @@',
      ' alpha',
      '-beta',
      '+bravo',
      ' gamma',
      ' delta',
      '',
    ].join('\n');
    expect(applyUnifiedDiff(source, patch)).toBe('alpha\nbravo\ngamma\ndelta\n');
  });

  it('rejects stale context rather than applying a fuzzy patch', () => {
    const patch = '@@ -1,1 +1,1 @@\n-stale\n+replacement\n';
    expect(() => applyUnifiedDiff('current\n', patch)).toThrow(/context does not match/);
  });

  it('supports a new file diff from an empty preimage', () => {
    const patch = '--- /dev/null\n+++ b/new.cpp\n@@ -0,0 +1,1 @@\n+int value = 1;\n';
    expect(applyUnifiedDiff('', patch)).toBe('int value = 1;');
  });
});
