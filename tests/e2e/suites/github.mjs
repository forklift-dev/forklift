// GitHub against the mock server in its GitHub flavor (Enterprise Server's /api/v3, Bearer tokens, its media
// type and API version, issue lists with pull requests, refs/pull/N/head): see hostingProvider.mjs.
import { hostingProviderSuite } from '../hostingProvider.mjs';

export default (context) =>
  hostingProviderSuite(context, { flavor: 'github', name: 'GitHub', server: 'https://github.com', tokenPage: 'github.com/settings/tokens', accept: 'application/vnd.github+json', pullRefs: true });
