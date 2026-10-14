/**
 * ─── Rich text sanitizing (server side) ───
 *
 * Cleans the scenario introduction HTML before it is stored. Keeps the
 * formatting the Tiptap editor and FictionLab imports produce (headings,
 * paragraphs, emphasis, lists, quotes, links, images, colours, alignment)
 * and removes everything that can run script or take over the page:
 * <script>/<style>/<iframe>, event handlers, javascript: URLs, and styles
 * or classes that could position content over the app.
 *
 * The browser applies the same rules again when rendering
 * (src/utils/sanitize.ts), which also covers HTML stored before this existed.
 *
 * @module sanitizeHtml
 */

import sanitize from 'sanitize-html';

/** CSS colour values only: #hex, rgb()/rgba()/hsl()/hsla(), or a colour keyword */
const COLOR = /^(#[0-9a-f]{3,8}|(rgb|rgba|hsl|hsla)\([\d\s.,%/]+\)|[a-z]+)$/i;
/** Plain lengths for image sizing */
const LENGTH = /^\d+(\.\d+)?(px|%|em|rem)?$|^auto$/;

export const ALLOWED_TAGS = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'hr', 'span', 'div',
  'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'mark', 'sub', 'sup',
  'blockquote', 'code', 'pre', 'ul', 'ol', 'li', 'a', 'img',
];

/**
 * Class names allowed on content: text styling only, never layout or position.
 * The ql-* classes come from Quill (FictionLab imports) and are styled in src/index.css.
 */
export const ALLOWED_CLASS = /^(text-(left|center|right|justify|xs|sm|base|lg|xl|[2-6]xl|[a-z]+-\d{2,3})|font-(normal|medium|semibold|bold|italic)|italic|underline|line-through|ql-align-(center|right|justify)|ql-direction-rtl|ql-indent-[1-8])$/;

const options = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: {
    '*': ['style', 'class'],
    a: ['href', 'target', 'rel'],
    img: ['src', 'alt', 'title', 'width', 'height'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: { img: ['http', 'https', 'data'] },
  allowProtocolRelative: false,
  allowedStyles: {
    '*': {
      color: [COLOR],
      'background-color': [COLOR],
      'text-align': [/^(left|right|center|justify)$/],
      'font-weight': [/^(normal|bold|[1-9]00)$/],
      'font-style': [/^(normal|italic)$/],
      'text-decoration': [/^(none|underline|line-through)$/],
    },
    img: {
      width: [LENGTH],
      height: [LENGTH],
      'max-width': [LENGTH],
    },
  },
  // Drop disallowed class names but keep the allowed ones on the element
  allowedClasses: { '*': [ALLOWED_CLASS] },
  transformTags: {
    a: (tagName, attribs) => {
      const out = { ...attribs };
      if (out.target) {
        out.target = '_blank';
        out.rel = 'noopener noreferrer';
      }
      return { tagName, attribs: out };
    },
    img: (tagName, attribs) => {
      // Only image data URLs, never data:text/html etc.
      if (attribs.src && attribs.src.startsWith('data:') && !/^data:image\/(png|jpe?g|gif|webp|bmp);base64,/i.test(attribs.src)) {
        const { src, ...rest } = attribs;
        return { tagName, attribs: rest };
      }
      return { tagName, attribs };
    },
  },
  disallowedTagsMode: 'discard',
};

/**
 * Returns safe HTML for rendering a scenario introduction.
 * @param {string} html
 * @returns {string}
 */
export function sanitizeRichText(html) {
  if (!html || typeof html !== 'string') return '';
  return sanitize(html, options);
}
