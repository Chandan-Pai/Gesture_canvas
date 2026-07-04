/** Public site config */
export const FEEDBACK_FORM_URL = 'https://forms.gle/wXJsxHMW4CyVTy3e8';

export function feedbackEmbedUrl() {
  const sep = FEEDBACK_FORM_URL.includes('?') ? '&' : '?';
  return `${FEEDBACK_FORM_URL}${sep}embedded=true`;
}
