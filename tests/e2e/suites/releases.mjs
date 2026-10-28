// A published release is visible in the app and can be dismissed without installing anything.
import { inMain, launchApp } from '../harness.mjs';

export const meta = { requiresMain: true };

export default async function ({ check }) {
  const app = await launchApp({ inspect: true });
  const { page } = app;
  const release = { version: '0.6.0', url: 'https://github.com/forklift-dev/forklift/releases/tag/v0.6.0' };
  await inMain(app, `store.dispatch({ type: 'app/releaseFound', payload: ${JSON.stringify(release)} }); return true;`);
  check('a newer release appears with a browser link', await page.waitFor(`document.querySelector('.release-banner')?.textContent.includes('0.6.0') && document.querySelector('.release-banner a')?.href === ${JSON.stringify(release.url)}`));
  await page.click(`document.querySelector('.release-banner button')`);
  check('Later hides the release notice', await page.waitFor(`!document.querySelector('.release-banner')`));
  await page.click(`document.querySelector('.status-community')`);
  check('About offers a manual release check', await page.waitFor(`document.querySelector('.about-update button')?.textContent === 'Check for updates'`));
  await page.press('Escape');
}
