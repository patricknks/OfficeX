import { useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({ gfm: true, breaks: true });

// links from agents open in a new tab and never get access to this window
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

/**
 * Renders an agent's markdown the way Claude Code would print it.
 * Agent text is untrusted (it can quote web pages), so the HTML is sanitized.
 */
export function Markdown({ text }: { text: string }) {
  const html = useMemo(() => {
    const withMentions = text.replace(/(^|\s)@(\w+)/g, '$1**@$2**');
    const raw = marked.parse(withMentions, { async: false }) as string;
    return DOMPurify.sanitize(raw, { FORBID_TAGS: ['style', 'img', 'iframe', 'form', 'input'], FORBID_ATTR: ['style'] });
  }, [text]);
  return <div className="md" dangerouslySetInnerHTML={{ __html: html }} />;
}
