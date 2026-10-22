// Codicons for the whole UI. Monaco adds the per-icon glyph rules (`.codicon-add::before`) only once an
// editor exists, so icons outside the diff view would stay blank until then; generate them up front.
import 'monaco-codicons/codicon.css';
import 'monaco-codicons/codicon-modifiers.css';
import 'monaco-editor/base/common/codicons';
import { getCodiconFontCharacters } from 'monaco-editor/base/common/codiconsUtil';

export function installCodicons(): void {
  const style = document.createElement('style');
  style.dataset['forklift'] = 'codicons';
  style.textContent = Object.entries(getCodiconFontCharacters())
    .map(([id, char]) => `.codicon-${id}::before{content:'\\${char.toString(16)}'}`)
    .join('\n');
  document.head.append(style);
}
