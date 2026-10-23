// The safe parts of Markdown.tsx without its React and Monaco side: references in text become in-app links,
// and only harmless URLs survive.

/** In-app links made from references in the text. */
export const REF = 'forklift:';

interface MdNode {
  type: string;
  value?: string;
  url?: string;
  children?: MdNode[];
}

/** `#12`, `!12` (GitLab merge requests), commit hashes and `@user` in text become in-app links. */
export function remarkRefs({ mergeRefs }: { mergeRefs: boolean }) {
  const pattern = new RegExp(
    [
      `(?<![\\w&/#!])([${mergeRefs ? '#!' : '#'}])(\\d{1,7})\\b`,
      // A hash: 7 to 40 hex digits with a letter and a digit in them (not a plain number or word).
      '\\b(?=[0-9a-f]*[a-f])(?=[0-9a-f]*\\d)([0-9a-f]{7,40})\\b',
      '(?<![\\w@.])@([A-Za-z0-9][\\w.-]{0,38}\\w|[A-Za-z0-9])',
    ].join('|'),
    'g',
  );
  const split = (text: string): MdNode[] => {
    const nodes: MdNode[] = [];
    let last = 0;
    for (const match of text.matchAll(pattern)) {
      if (match.index > last) nodes.push({ type: 'text', value: text.slice(last, match.index) });
      const [whole, mark, number, sha, user] = match;
      const url = mark ? `${REF}${mark === '!' ? 'pull' : 'issue'}/${number}` : sha ? `${REF}sha/${sha}` : `${REF}user/${user}`;
      nodes.push({ type: 'link', url, children: [{ type: 'text', value: whole }] });
      last = match.index + whole.length;
    }
    if (last < text.length) nodes.push({ type: 'text', value: text.slice(last) });
    return nodes;
  };
  const walk = (node: MdNode) => {
    // Not inside links and code (they keep their text as written).
    if (!node.children || node.type === 'link' || node.type === 'linkReference') return;
    node.children = node.children.flatMap((child) => (child.type === 'text' && child.value ? split(child.value) : (walk(child), [child])));
  };
  return (tree: MdNode) => walk(tree);
}

/** Only web and mail links and the app's own references survive; anything else (javascript:, file:…) is dropped. */
export const urlTransform = (url: string) => (/^(https?:|mailto:|forklift:)/i.test(url) ? url : '');
