/**
 * Rich Text Editor Component (Tiptap)
 *
 * A full-featured rich text editor built on Tiptap (ProseMirror).
 * Supports bold, italic, underline, headings, lists, blockquotes,
 * links, embedded images (base64), and undo/redo.
 *
 * @module RichtextEditor
 */

import React, { useCallback } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import {
  Bold, Italic, Underline as UnderlineIcon, List, ListOrdered,
  Quote, Heading1, Heading2, Heading3, Link as LinkIcon,
  Image as ImageIcon, Undo2, Redo2, AlignLeft, AlignCenter, AlignRight
} from 'lucide-react';

interface RichtextEditorProps {
  content: string;
  onChange: (html: string) => void;
  placeholder?: string;
}

export const RichtextEditor: React.FC<RichtextEditorProps> = ({ content, onChange }) => {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
      }),
      Image.configure({
        inline: false,
        allowBase64: true,
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'text-indigo-400 underline hover:text-indigo-300',
        },
      }),
      Underline,
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
    ],
    content: content || '',
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      onChange(html === '<p></p>' ? '' : html);
    },
    editorProps: {
      attributes: {
        class: 'prose prose-invert max-w-none focus:outline-none min-h-[250px] px-4 py-4 text-white',
      },
    },
  });

  const handleImageUpload = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;

      // Limit image size to 5MB
      if (file.size > 5 * 1024 * 1024) {
        alert('Image must be less than 5MB');
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        const url = reader.result as string;
        editor?.chain().focus().setImage({ src: url }).run();
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }, [editor]);

  const setLink = useCallback(() => {
    if (!editor) return;
    const previousUrl = editor.getAttributes('link').href;
    const url = window.prompt('Enter URL', previousUrl || '');
    if (url === null) return;
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  }, [editor]);

  if (!editor) {
    return (
      <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-4">
        <div className="h-[250px] flex items-center justify-center text-zinc-600">Loading editor...</div>
      </div>
    );
  }

  const ToolbarButton = ({ onClick, active, children, title }: { onClick: () => void; active?: boolean; children: React.ReactNode; title?: string }) => (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`p-1.5 rounded-lg transition-colors ${
        active
          ? 'bg-indigo-600/20 text-indigo-400'
          : 'text-zinc-500 hover:text-white hover:bg-zinc-800'
      }`}
    >
      {children}
    </button>
  );

  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded-2xl overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 px-3 py-2 border-b border-zinc-800 bg-zinc-900/50">
        <div className="flex items-center gap-0.5 pr-2 border-r border-zinc-800">
          <ToolbarButton onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="Bold"><Bold size={16} /></ToolbarButton>
          <ToolbarButton onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="Italic"><Italic size={16} /></ToolbarButton>
          <ToolbarButton onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')} title="Underline"><UnderlineIcon size={16} /></ToolbarButton>
        </div>

        <div className="flex items-center gap-0.5 px-2 border-r border-zinc-800">
          <ToolbarButton onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} active={editor.isActive('heading', { level: 1 })} title="Heading 1"><Heading1 size={16} /></ToolbarButton>
          <ToolbarButton onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive('heading', { level: 2 })} title="Heading 2"><Heading2 size={16} /></ToolbarButton>
          <ToolbarButton onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive('heading', { level: 3 })} title="Heading 3"><Heading3 size={16} /></ToolbarButton>
        </div>

        <div className="flex items-center gap-0.5 px-2 border-r border-zinc-800">
          <ToolbarButton onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="Bullet List"><List size={16} /></ToolbarButton>
          <ToolbarButton onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="Ordered List"><ListOrdered size={16} /></ToolbarButton>
          <ToolbarButton onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive('blockquote')} title="Blockquote"><Quote size={16} /></ToolbarButton>
        </div>

        <div className="flex items-center gap-0.5 px-2 border-r border-zinc-800">
          <ToolbarButton onClick={() => editor.chain().focus().setTextAlign('left').run()} active={editor.isActive({ textAlign: 'left' })} title="Align Left"><AlignLeft size={16} /></ToolbarButton>
          <ToolbarButton onClick={() => editor.chain().focus().setTextAlign('center').run()} active={editor.isActive({ textAlign: 'center' })} title="Align Center"><AlignCenter size={16} /></ToolbarButton>
          <ToolbarButton onClick={() => editor.chain().focus().setTextAlign('right').run()} active={editor.isActive({ textAlign: 'right' })} title="Align Right"><AlignRight size={16} /></ToolbarButton>
        </div>

        <div className="flex items-center gap-0.5 px-2 border-r border-zinc-800">
          <ToolbarButton onClick={setLink} active={editor.isActive('link')} title="Insert Link"><LinkIcon size={16} /></ToolbarButton>
          <ToolbarButton onClick={handleImageUpload} title="Insert Image"><ImageIcon size={16} /></ToolbarButton>
        </div>

        <div className="flex items-center gap-0.5 px-2">
          <ToolbarButton onClick={() => editor.chain().focus().undo().run()} title="Undo"><Undo2 size={16} /></ToolbarButton>
          <ToolbarButton onClick={() => editor.chain().focus().redo().run()} title="Redo"><Redo2 size={16} /></ToolbarButton>
        </div>
      </div>

      {/* Editor Content */}
      <EditorContent editor={editor} className="text-white [&_.ProseMirror_p.is-editor-empty:first-child::before]:text-zinc-600 [&_.ProseMirror_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)] [&_.ProseMirror_p.is-editor-empty:first-child::before]:float-left [&_.ProseMirror_p.is-editor-empty:first-child::before]:pointer-events-none [&_.ProseMirror_p.is-editor-empty:first-child::before]:h-0" />

      {/* Bubble menu for text selection */}
      {editor && (
        <BubbleMenu editor={editor} className="flex items-center gap-0.5 bg-zinc-800 border border-zinc-700 rounded-xl p-1 shadow-xl">
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => editor.chain().focus().toggleBold().run()}
              className={`p-1.5 rounded-lg ${editor.isActive('bold') ? 'bg-indigo-600/20 text-indigo-400' : 'text-zinc-300 hover:text-white'}`}
            >
              <Bold size={14} />
            </button>
            <button
              onClick={() => editor.chain().focus().toggleItalic().run()}
              className={`p-1.5 rounded-lg ${editor.isActive('italic') ? 'bg-indigo-600/20 text-indigo-400' : 'text-zinc-300 hover:text-white'}`}
            >
              <Italic size={14} />
            </button>
            <button
              onClick={() => editor.chain().focus().toggleUnderline().run()}
              className={`p-1.5 rounded-lg ${editor.isActive('underline') ? 'bg-indigo-600/20 text-indigo-400' : 'text-zinc-300 hover:text-white'}`}
            >
              <UnderlineIcon size={14} />
            </button>
            <button
              onClick={setLink}
              className={`p-1.5 rounded-lg ${editor.isActive('link') ? 'bg-indigo-600/20 text-indigo-400' : 'text-zinc-300 hover:text-white'}`}
            >
              <LinkIcon size={14} />
            </button>
          </div>
        </BubbleMenu>
      )}
    </div>
  );
};
