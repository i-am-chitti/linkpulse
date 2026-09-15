import { describe, expect, it } from 'vitest';
import { formSchema } from '../app/(auth)/register/page';

// Regression test for the bug caught live: an untouched Name field submits
// "" to a schema where name is optional but, once provided, must be >=1
// character - so a blank optional field failed the same check as "provided
// and too short", when the field is entirely optional.
describe('register form schema', () => {
  it('accepts a blank name as not provided', () => {
    const result = formSchema.safeParse({
      email: 'ada@example.com',
      password: 'correct-horse-battery',
      name: '',
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.name).toBeUndefined();
  });

  it('still rejects a real name that is too short after trimming', () => {
    const result = formSchema.safeParse({
      email: 'ada@example.com',
      password: 'correct-horse-battery',
      name: '   ',
    });

    expect(result.success).toBe(false);
  });

  it('keeps a real name as-is', () => {
    const result = formSchema.safeParse({
      email: 'ada@example.com',
      password: 'correct-horse-battery',
      name: 'Ada Lovelace',
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.name).toBe('Ada Lovelace');
  });
});
