import sanitizeHtml from 'sanitize-html';

export function sanitize(input: string): string {
  if (!input) return input;

  return sanitizeHtml(input, {
    allowedTags: [], // Strip absolutely all HTML tags
    allowedAttributes: {},
    disallowedTagsMode: 'discard',
  });
}
