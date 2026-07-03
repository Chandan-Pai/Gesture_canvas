/**
 * Public site config — update FEEDBACK_FORM_URL with your Google Form link.
 * Create a form at https://forms.google.com → Send → link icon → copy URL.
 *
 * Example:
 *   https://docs.google.com/forms/d/e/1FAIpQLSd_example/viewform
 */
export const FEEDBACK_FORM_URL =
  'https://docs.google.com/forms/d/e/REPLACE_WITH_YOUR_FORM_ID/viewform';

export function feedbackEmbedUrl() {
  const base = FEEDBACK_FORM_URL.replace(/\/viewform.*$/, '/viewform');
  return `${base}?embedded=true`;
}
