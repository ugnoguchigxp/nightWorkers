import type { SectionSampleDefinition } from './types';

export const codeEditorSectionSample: SectionSampleDefinition = {
  name: 'CodeEditorSection',
  props: ({ base }) => ({
    ...base,
    lines: [
      'function fizzBuzz(limit: number) {',
      '  const output: string[] = [];',
      '',
      '  for (let n = 1; n <= limit; n += 1) {',
      '    const fizz = n % 3 === 0;',
      '    const buzz = n % 5 === 0;',
      '',
      "    if (fizz && buzz) output.push('FizzBuzz');",
      "    else if (fizz) output.push('Fizz');",
      "    else if (buzz) output.push('Buzz');",
      '    else output.push(String(n));',
      '  }',
      '',
      '  return output;',
      '}',
      '',
      'console.log(fizzBuzz(30).join("\\n"));',
    ],
  }),
};
