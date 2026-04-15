import './RichTextEditor.css';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import { Color } from '@tiptap/extension-color';
import { TextStyle } from '@tiptap/extension-text-style';
import FontSize from 'tiptap-extension-font-size';
import Image from '@tiptap/extension-image';
import TextAlign from '@tiptap/extension-text-align';
import Highlight from '@tiptap/extension-highlight';
import Link from '@tiptap/extension-link';
import Superscript from '@tiptap/extension-superscript';
import Subscript from '@tiptap/extension-subscript';
import { Placeholder } from '@tiptap/extension-placeholder';
import { useEffect, useRef } from 'react';

export const isEditorEmpty = (html) =>
  !html || html.replace(/<[^>]*>/g, '').trim() === '';

const FONT_SIZES = ['12px', '14px', '16px', '18px', '20px', '24px'];

function MenuBar({ editor, fileInputRef }) {
  if (!editor) return null;

  const setLink = () => {
    const prev = editor.getAttributes('link').href;
    const url = window.prompt('링크 URL 입력', prev || 'https://');
    if (url === null) return;
    if (url === '') { editor.chain().focus().extendMarkRange('link').unsetLink().run(); return; }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  };

  return (
    <div className="tiptap-toolbar">
      {/* 실행취소 / 다시실행 */}
      <button type="button" onClick={() => editor.chain().focus().undo().run()}
        disabled={!editor.can().undo()} title="실행취소">
        <UndoIcon />
      </button>
      <button type="button" onClick={() => editor.chain().focus().redo().run()}
        disabled={!editor.can().redo()} title="다시실행">
        <RedoIcon />
      </button>

      <div className="divider" />

      {/* 제목 */}
      <select title="제목"
        value={
          editor.isActive('heading', { level: 1 }) ? '1' :
          editor.isActive('heading', { level: 2 }) ? '2' :
          editor.isActive('heading', { level: 3 }) ? '3' : '0'
        }
        onChange={(e) => {
          const v = e.target.value;
          if (v === '0') editor.chain().focus().setParagraph().run();
          else editor.chain().focus().toggleHeading({ level: Number(v) }).run();
        }}>
        <option value="0">본문</option>
        <option value="1">제목 1</option>
        <option value="2">제목 2</option>
        <option value="3">제목 3</option>
      </select>

      {/* 글자 크기 */}
      <select title="글자크기" defaultValue=""
        onChange={(e) => editor.chain().focus().setFontSize(e.target.value).run()}>
        <option value="" disabled>크기</option>
        {FONT_SIZES.map(s => <option key={s} value={s}>{s.replace('px', '')}</option>)}
      </select>

      <div className="divider" />

      {/* 목록 */}
      <button type="button"
        className={editor.isActive('bulletList') ? 'is-active' : ''}
        onClick={() => editor.chain().focus().toggleBulletList().run()} title="글머리 목록">
        <BulletListIcon />
      </button>
      <button type="button"
        className={editor.isActive('orderedList') ? 'is-active' : ''}
        onClick={() => editor.chain().focus().toggleOrderedList().run()} title="번호 목록">
        <OrderedListIcon />
      </button>
      <button type="button"
        className={editor.isActive('blockquote') ? 'is-active' : ''}
        onClick={() => editor.chain().focus().toggleBlockquote().run()} title="인용문">
        <BlockquoteIcon />
      </button>

      <div className="divider" />

      {/* 서식 */}
      <button type="button"
        className={editor.isActive('bold') ? 'is-active' : ''}
        onClick={() => editor.chain().focus().toggleBold().run()} title="굵게">
        <b style={{ fontSize: '0.9rem' }}>B</b>
      </button>
      <button type="button"
        className={editor.isActive('italic') ? 'is-active' : ''}
        onClick={() => editor.chain().focus().toggleItalic().run()} title="기울기">
        <i style={{ fontSize: '0.9rem' }}>I</i>
      </button>
      <button type="button"
        className={editor.isActive('strike') ? 'is-active' : ''}
        onClick={() => editor.chain().focus().toggleStrike().run()} title="취소선">
        <s style={{ fontSize: '0.9rem' }}>S</s>
      </button>
      <button type="button"
        className={editor.isActive('code') ? 'is-active' : ''}
        onClick={() => editor.chain().focus().toggleCode().run()} title="인라인 코드">
        <CodeIcon />
      </button>
      <button type="button"
        className={editor.isActive('underline') ? 'is-active' : ''}
        onClick={() => editor.chain().focus().toggleUnderline().run()} title="밑줄">
        <u style={{ fontSize: '0.9rem' }}>U</u>
      </button>
      <button type="button"
        className={editor.isActive('highlight') ? 'is-active' : ''}
        onClick={() => editor.chain().focus().toggleHighlight().run()} title="형광펜">
        <HighlightIcon />
      </button>
      <button type="button"
        className={editor.isActive('link') ? 'is-active' : ''}
        onClick={setLink} title="링크">
        <LinkIcon />
      </button>

      <div className="divider" />

      {/* 위첨자 / 아래첨자 */}
      <button type="button"
        className={editor.isActive('superscript') ? 'is-active' : ''}
        onClick={() => editor.chain().focus().toggleSuperscript().run()} title="위첨자">
        x<sup style={{ fontSize: '0.6em' }}>2</sup>
      </button>
      <button type="button"
        className={editor.isActive('subscript') ? 'is-active' : ''}
        onClick={() => editor.chain().focus().toggleSubscript().run()} title="아래첨자">
        x<sub style={{ fontSize: '0.6em' }}>2</sub>
      </button>

      <div className="divider" />

      {/* 글자색 */}
      <label style={{ display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer' }} title="글자색">
        <span style={{ fontSize: '0.72rem', color: 'var(--color-text-faint)' }}>A</span>
        <input type="color" defaultValue="#000000"
          onChange={(e) => editor.chain().focus().setColor(e.target.value).run()}
          style={{ width: 20, height: 20, padding: 0, border: '1px solid var(--color-border)', borderRadius: 3, cursor: 'pointer' }}
        />
      </label>

      <div className="divider" />

      {/* 정렬 */}
      {['left', 'center', 'right', 'justify'].map((align) => (
        <button key={align} type="button"
          className={editor.isActive({ textAlign: align }) ? 'is-active' : ''}
          onClick={() => editor.chain().focus().setTextAlign(align).run()}
          title={{ left: '왼쪽', center: '가운데', right: '오른쪽', justify: '양쪽' }[align] + ' 정렬'}>
          {align === 'left'    && <AlignLeftIcon />}
          {align === 'center'  && <AlignCenterIcon />}
          {align === 'right'   && <AlignRightIcon />}
          {align === 'justify' && <AlignJustifyIcon />}
        </button>
      ))}

      <div className="divider" />

      {/* 이미지 첨부 */}
      <button type="button" onClick={() => fileInputRef.current?.click()} title="이미지 첨부"
        style={{ width: 'auto', padding: '0 8px', gap: 4, display: 'flex', alignItems: 'center', fontSize: '0.78rem' }}>
        <ImageIcon />
        <span>Add</span>
      </button>
      <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} />
    </div>
  );
}

export default function RichTextEditor({ content, onChange }) {
  const fileInputRef = useRef(null);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      TextStyle,
      Color,
      FontSize,
      Highlight,
      Link.configure({ openOnClick: false }),
      Superscript,
      Subscript,
      Image.configure({ inline: false, allowBase64: true }),
      TextAlign.configure({ types: ['heading', 'paragraph'], defaultAlignment: 'left' }),
      Placeholder.configure({ placeholder: '내용을 입력하세요' }),
    ],
    content: content || '',
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });

  // 파일 선택 → base64 삽입
  useEffect(() => {
    const input = fileInputRef.current;
    if (!input || !editor) return;
    const handler = (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => editor.chain().focus().setImage({ src: reader.result }).run();
      reader.readAsDataURL(file);
      e.target.value = '';
    };
    input.addEventListener('change', handler);
    return () => input.removeEventListener('change', handler);
  }, [editor]);

  // 외부 content 리셋
  useEffect(() => {
    if (!editor) return;
    if (content === '' && editor.getHTML() !== '<p></p>') {
      editor.commands.setContent('');
    }
  }, [content, editor]);

  // 수정 모드 진입 시 기존 HTML 로드
  useEffect(() => {
    if (!editor) return;
    if (content && content !== editor.getHTML()) {
      editor.commands.setContent(content, false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  return (
    <div className="tiptap-editor-wrapper">
      <MenuBar editor={editor} fileInputRef={fileInputRef} />
      <div className="tiptap-content">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

/* ── 아이콘 ── */
const UndoIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg>;
const RedoIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 14 20 9 15 4"/><path d="M4 20v-7a4 4 0 0 1 4-4h12"/></svg>;
const BulletListIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="4" cy="7" r="1.5"/><circle cx="4" cy="12" r="1.5"/><circle cx="4" cy="17" r="1.5"/><rect x="8" y="6" width="13" height="2" rx="1"/><rect x="8" y="11" width="13" height="2" rx="1"/><rect x="8" y="16" width="13" height="2" rx="1"/></svg>;
const OrderedListIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><text x="2" y="9" fontSize="8" fontWeight="bold">1.</text><text x="2" y="14.5" fontSize="8" fontWeight="bold">2.</text><text x="2" y="20" fontSize="8" fontWeight="bold">3.</text><rect x="10" y="6" width="11" height="2" rx="1"/><rect x="10" y="11" width="11" height="2" rx="1"/><rect x="10" y="16" width="11" height="2" rx="1"/></svg>;
const BlockquoteIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1zm12 0c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/></svg>;
const CodeIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>;
const HighlightIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M15.5 2.1L21.9 8.5 9.3 21.1 2.9 14.7 15.5 2.1zM3 22l4-.9-3.1-3.1L3 22z" opacity=".8"/></svg>;
const LinkIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>;
const ImageIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>;
const AlignLeftIcon = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="5" width="18" height="2" rx="1"/><rect x="3" y="11" width="12" height="2" rx="1"/><rect x="3" y="17" width="15" height="2" rx="1"/></svg>;
const AlignCenterIcon = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="5" width="18" height="2" rx="1"/><rect x="6" y="11" width="12" height="2" rx="1"/><rect x="4" y="17" width="16" height="2" rx="1"/></svg>;
const AlignRightIcon = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="5" width="18" height="2" rx="1"/><rect x="9" y="11" width="12" height="2" rx="1"/><rect x="6" y="17" width="15" height="2" rx="1"/></svg>;
const AlignJustifyIcon = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="5" width="18" height="2" rx="1"/><rect x="3" y="11" width="18" height="2" rx="1"/><rect x="3" y="17" width="18" height="2" rx="1"/></svg>;
