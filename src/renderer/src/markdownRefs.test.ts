import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { describe, expect, it } from 'vitest';
import { remarkRefs, urlTransform } from './markdownRefs';

const render = (text: string, mergeRefs = false) =>
  renderToStaticMarkup(createElement(Markdown, { remarkPlugins: [remarkGfm, [remarkRefs, { mergeRefs }]], skipHtml: true, urlTransform }, text));

describe('markdown of pull requests and issues', () => {
  it('renders markdown as elements', () => {
    expect(render('**bold** and `code`\n\n- [x] done')).toBe('<p><strong>bold</strong> and <code>code</code></p>\n<ul class="contains-task-list">\n<li class="task-list-item"><input type="checkbox" disabled="" checked=""/> done</li>\n</ul>');
  });

  it('turns #N, hashes and @user into in-app links, !N only where it means a merge request', () => {
    expect(render('Fixes #12, see 3e8409d and @ada.')).toBe('<p>Fixes <a href="forklift:issue/12">#12</a>, see <a href="forklift:sha/3e8409d">3e8409d</a> and <a href="forklift:user/ada">@ada</a>.</p>');
    expect(render('Wow!3 then !4', true)).toBe('<p>Wow!3 then <a href="forklift:pull/4">!4</a></p>');
    expect(render('Wow !4')).toBe('<p>Wow !4</p>');
  });

  it('leaves alone what only looks like a reference', () => {
    expect(render('C# and a#1, 1234567, deadbeef, ada@example.com, `#5` and [#6](https://x.example/6)')).toBe(
      '<p>C# and a#1, 1234567, deadbeef, <a href="mailto:ada@example.com">ada@example.com</a>, <code>#5</code> and <a href="https://x.example/6">#6</a></p>',
    );
  });

  it('drops raw HTML and dangerous links', () => {
    const html = render('<script>alert(1)</script><img src=x onerror=alert(1)>\n\n[x](javascript:alert(1)) [y](file:///etc/passwd) [z](data:text/html,hi) <b>b</b>');
    expect(html).not.toMatch(/<script|<img|onerror|javascript:|file:|data:|<b>/);
    expect(html).toContain('<a href="">x</a>');
  });

  it('keeps web and mail links', () => {
    expect(urlTransform('https://example.com')).toBe('https://example.com');
    expect(urlTransform('mailto:ada@example.com')).toBe('mailto:ada@example.com');
    expect(urlTransform(' javascript:alert(1)')).toBe('');
    expect(urlTransform('JaVaScRiPt:alert(1)')).toBe('');
    expect(urlTransform('/relative')).toBe('');
  });

  it('copes with a large text', () => {
    const text = Array.from({ length: 2000 }, (_, i) => `- item ${i} #${i} @user${i}`).join('\n');
    const started = performance.now();
    expect(render(text)).toContain('forklift:issue/1999');
    expect(performance.now() - started).toBeLessThan(3000);
  });
});
