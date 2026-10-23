// GitVerse against the mock server in its GitVerse flavor (API under /api, Bearer tokens, the API version in
// Accept, issue lists with pull requests, no refs/pull/N/head): see hostingProvider.mjs.
import { hostingProviderSuite } from '../hostingProvider.mjs';

export default (context) =>
  hostingProviderSuite(context, { flavor: 'gitverse', name: 'GitVerse', server: 'https://gitverse.ru', tokenPage: 'gitverse.ru/settings/tokens', accept: 'application/vnd.gitverse.object+json;version=1', pullRefs: false });
