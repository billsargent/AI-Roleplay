/**
 * ─── Rich text sanitizing (browser side) ───
 *
 * Cleans scenario introduction HTML right before it is rendered with
 * dangerouslySetInnerHTML. Mirrors the server rules in lib/sanitizeHtml.js
 * so content stored before server-side cleaning existed is also safe.
 */
import DOMPurify from 'dompurify';

const ALLOWED_TAGS = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'hr', 'span', 'div',
  'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'mark', 'sub', 'sup',
  'blockquote', 'code', 'pre', 'ul', 'ol', 'li', 'a', 'img',
];
const ALLOWED_ATTR = ['style', 'class', 'href', 'target', 'rel', 'src', 'alt', 'title', 'width', 'height'];

/** Same class rule as the server: text styling only, never layout or position */
const ALLOWED_CLASS = /^(text-(left|center|right|justify|xs|sm|base|lg|xl|[2-6]xl|[a-z]+-\d{2,3})|font-(normal|medium|semibold|bold|italic)|italic|underline|line-through|ql-align-(center|right|justify)|ql-direction-rtl|ql-indent-[1-8])$/;
const COLOR = /^(#[0-9a-f]{3,8}|(rgb|rgba|hsl|hsla)\([\d\s.,%/]+\)|[a-z]+)$/i;
const LENGTH = /^\d+(\.\d+)?(px|%|em|rem)?$|^auto$/;
const ALLOWED_STYLE: Record<string, RegExp> = {
  color: COLOR,
  'background-color': COLOR,
  'text-align': /^(left|right|center|justify)$/,
  'font-weight': /^(normal|bold|[1-9]00)$/,
  'font-style': /^(normal|italic)$/,
  'text-decoration': /^(none|underline|line-through)$/,
  width: LENGTH,
  height: LENGTH,
  'max-width': LENGTH,
};

let hooksInstalled = false;

function installHooks() {
  if (hooksInstalled) return;
  hooksInstalled = true;

  DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
    if (data.attrName === 'class') {
      data.attrValue = data.attrValue.split(/\s+/).filter(c => ALLOWED_CLASS.test(c)).join(' ');
      if (!data.attrValue) data.keepAttr = false;
    } else if (data.attrName === 'style') {
      const kept: string[] = [];
      for (const decl of data.attrValue.split(';')) {
        const i = decl.indexOf(':');
        if (i < 0) continue;
        const prop = decl.slice(0, i).trim().toLowerCase();
        const value = decl.slice(i + 1).trim();
        const rule = ALLOWED_STYLE[prop];
        if (rule && rule.test(value)) kept.push(`${prop}: ${value}`);
      }
      data.attrValue = kept.join('; ');
      if (!data.attrValue) data.keepAttr = false;
    } else if (data.attrName === 'src' && node.nodeName === 'IMG') {
      const v = data.attrValue.trim();
      const ok = /^https?:\/\//i.test(v) || v.startsWith('/') || /^data:image\/(png|jpe?g|gif|webp|bmp);base64,/i.test(v);
      if (!ok || v.startsWith('//')) data.keepAttr = false;
    }
  });

  // Links that open a new tab must not get access to this window
  DOMPurify.addHook('afterSanitizeAttributes', node => {
    if (node.nodeName === 'A' && node.getAttribute('target')) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });
}

/**
 * Returns safe HTML for a scenario introduction.
 * @param html - Untrusted rich text HTML
 */
export function sanitizeRichText(html: string | undefined | null): string {
  if (!html) return '';
  installHooks();
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
  });
}
