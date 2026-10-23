// GitLab against its mock server (API v4, Bearer tokens, projects by encoded path, merge requests and issues
// numbered separately, refs/merge-requests/N/head): the shared scenario of hostingProvider.mjs, then what is
// GitLab's own — "Merge requests" in the panel, !1 links, comments on a merge request, a merge request created.
import { startGitLabMock } from '../gitlabMock.mjs';
import { hostingProviderSuite } from '../hostingProvider.mjs';

const button = (scope, label) => `[...${scope}.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(label)})`;
const view = `document.querySelector('.hosting-view')`;
const viewText = `(${view}?.textContent ?? '')`;
const formDialog = `document.querySelector('.form-dialog')`;

export default (context) =>
  hostingProviderSuite(context, {
    flavor: 'gitlab',
    name: 'GitLab',
    server: 'https://gitlab.com',
    tokenPage: 'Access tokens',
    accept: 'application/json',
    pullRef: 'refs/merge-requests/2/head',
    startMock: startGitLabMock,
    async extra({ page, check, mock, root, sh }) {
      check('the panel says “Merge requests”', await page.waitFor(`document.querySelector('.ref-section[data-section="pulls"]')?.getAttribute('aria-label') === 'Merge requests'`));
      await page.click(`document.querySelector('[data-hosting="issue-3"]')`);
      await page.waitFor(`/It crashes/.test(${viewText})`);
      await page.click(`[...${view}.querySelectorAll('.issue-ref')].find(b => b.textContent === '!1')`);
      check('!1 opens merge request !1', await page.waitFor(`/!1 Add the feature/.test(${viewText}) && /merge request ·/.test(${viewText}) && /Add the feature/.test(${viewText}) && /Looks good to me/.test(${viewText}) && !/changed the description/.test(${viewText})`));
      check('#3 in its description is issue 3', await page.evaluate(`[...${view}.querySelectorAll('.issue-ref')].some(b => b.textContent === '#3')`));
      await page.fill(`${view}.querySelector('textarea')`, 'Merge it');
      await page.click(button(view, 'Comment'));
      check('a comment goes to the merge request, not issue 1', await page.waitFor(`/Merge it/.test(${viewText})`) && mock.notes['mr-1'].some((n) => n.body === 'Merge it') && !mock.notes['issue-1']);
      // A new branch, pushed by the app (git gets the token; nobody is asked).
      await page.invoke('branch:create', root, 'topic', sh(root, 'rev-parse', 'main'), true);
      check('push with the token', (await page.invoke('remote:push', root, 'origin', false))?.ok === true && !(await page.evaluate(`!!document.querySelector('.prompt-dialog')`)));
      await page.click(`document.querySelector('.ref-section[data-section="pulls"] [aria-label="Create a merge request"]')`);
      await page.waitFor(`!!${formDialog}`);
      check('the form is for a merge request', /Merge request from topic/.test(await page.evaluate(`${formDialog}.textContent`)));
      await page.fill(`${formDialog}.querySelector('[name="title"]')`, 'Topic work');
      await page.click(button(formDialog, 'Create merge request'));
      check('the merge request is created and shown', await page.waitFor(`!${formDialog} && /Topic work/.test(${viewText})`, 8000) && mock.mrs[0].source_branch === 'topic');
    },
  });
