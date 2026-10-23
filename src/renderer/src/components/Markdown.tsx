import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { PROVIDERS, type HostingProvider } from '../../../shared/hosting';
import { monaco } from '../monaco/setup';
import { REF, remarkRefs, urlTransform } from '../markdownRefs';
import type { HostingItem } from './HostingView';

// Markdown of pull requests, issues and comments: written by other people, so untrusted. It becomes React
// elements only (no raw HTML, no innerHTML); links leave through the window's https-only handler; images are
// not loaded (the CSP forbids them, and they would tell the image's server who reads what).

/** Longer texts are shown as they are (rendering them would stall the window). */
const MAX_LENGTH = 200_000;
/** Monaco's language for a fence's info string ("ts", "python", "rs"…), or null. */
function fenceLanguage(name: string): string | null {
  const wanted = name.toLowerCase();
  const language = monaco.languages
    .getLanguages()
    .find((candidate) => candidate.id === wanted || candidate.aliases?.some((alias) => alias.toLowerCase() === wanted) || candidate.extensions?.includes(`.${wanted}`));
  return language?.id ?? null;
}

/**
 * Monaco's colorized HTML rebuilt as React elements: only its token spans (class "mtkN…") and line breaks are
 * kept, everything else becomes text — so nothing from the code block can turn into markup.
 */
function tokensToReact(html: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let key = 0;
  const visit = (node: Node) => {
    // Monaco writes spaces as &nbsp;: copied code should have plain ones.
    if (node.nodeType === Node.TEXT_NODE) nodes.push((node.textContent ?? '').replace(/\u00a0/g, ' '));
    else if (node instanceof HTMLBRElement) nodes.push('\n');
    else if (node instanceof HTMLSpanElement && /^mtk\d+(?: mtk[ibus])*$/.test(node.className) && node.childNodes.length === 1 && node.firstChild?.nodeType === Node.TEXT_NODE) {
      nodes.push(
        <span key={key++} className={node.className}>
          {(node.textContent ?? '').replace(/\u00a0/g, ' ')}
        </span>,
      );
    } else node.childNodes.forEach(visit);
  };
  new DOMParser().parseFromString(html, 'text/html').body.childNodes.forEach(visit);
  // The last line's break.
  if (nodes.at(-1) === '\n') nodes.pop();
  return nodes;
}

function CodeBlock({ code, language }: { code: string; language: string | null }) {
  const [colored, setColored] = useState<ReactNode[] | null>(null);
  useEffect(() => {
    if (!language) return;
    let current = true;
    void monaco.editor.colorize(code, language, { tabSize: 4 }).then(
      (html) => current && setColored(tokensToReact(html)),
      () => {},
    );
    return () => {
      current = false;
    };
  }, [code, language]);
  return (
    <pre className="md-code">
      <code>{colored ?? code}</code>
    </pre>
  );
}

/** Where in-app links lead (the components below are module-level, so they read it from here). */
const Actions = createContext<{ onOpen(item: HostingItem): void; onShowCommit(sha: string): void }>({ onOpen: () => {}, onShowCommit: () => {} });

function Link({ href, children }: { href?: string; children?: ReactNode }) {
  const { onOpen, onShowCommit } = useContext(Actions);
  if (!href) return <>{children}</>;
  if (href.startsWith(REF)) {
    const [what, value = ''] = href.slice(REF.length).split('/');
    if (what === 'pull' || what === 'issue') {
      const item: HostingItem = { kind: what, number: Number(value) };
      return (
        <button type="button" className="link-button issue-ref" onClick={() => onOpen(item)}>
          {children}
        </button>
      );
    }
    if (what === 'sha') {
      return (
        <button type="button" className="link-button hash" title="Show in the graph" onClick={() => onShowCommit(value)}>
          {children}
        </button>
      );
    }
    return <span className="md-mention">{children}</span>;
  }
  return (
    <a href={href} target="_blank" rel="noreferrer" title={href}>
      {children}
    </a>
  );
}

function Image({ src, alt }: { src?: string | Blob; alt?: string }) {
  const label = `image${alt ? `: ${alt}` : ''}`;
  return typeof src === 'string' && /^https:/i.test(src) ? (
    <a className="md-image" href={src} target="_blank" rel="noreferrer" title={src}>
      [{label}]
    </a>
  ) : (
    <span className="md-image">[{label}]</span>
  );
}

function Code({ className, children }: { className?: string; children?: ReactNode }) {
  const code = String(children ?? '');
  const fence = /language-([\w+#.-]+)/.exec(className ?? '');
  // Fenced and indented blocks end with a newline; inline code does not.
  if (!fence && !code.includes('\n')) return <code className="md-inline-code">{code}</code>;
  return <CodeBlock code={code.replace(/\n$/, '')} language={fence ? fenceLanguage(fence[1]!) : null} />;
}

const Pre = ({ children }: { children?: ReactNode }) => <>{children}</>;
const Checkbox = ({ checked }: { checked?: boolean }) => <input type="checkbox" checked={Boolean(checked)} disabled aria-label={checked ? 'Done' : 'Not done'} />;

const COMPONENTS: Components = { a: Link, img: Image, pre: Pre, code: Code, input: Checkbox };

interface MarkdownProps {
  text: string;
  provider: HostingProvider;
  onOpen(item: HostingItem): void;
  /** Shows a commit in the graph. */
  onShowCommit(sha: string): void;
}

export function Markdown({ text, provider, onOpen, onShowCommit }: MarkdownProps) {
  const actions = useMemo(() => ({ onOpen, onShowCommit }), [onOpen, onShowCommit]);
  if (text.length > MAX_LENGTH) return <div className="markdown md-plain">{text}</div>;
  return (
    <Actions.Provider value={actions}>
      <div className="markdown">
        <ReactMarkdown remarkPlugins={[remarkGfm, [remarkRefs, { mergeRefs: Boolean(PROVIDERS[provider].mergeRefs) }]]} skipHtml urlTransform={urlTransform} components={COMPONENTS}>
          {text}
        </ReactMarkdown>
      </div>
    </Actions.Provider>
  );
}
