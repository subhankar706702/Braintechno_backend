import type { ProviderPublishInput, ProviderPublishResult, SocialProvider } from './types';

const LINKEDIN_POSTS_URL = 'https://api.linkedin.com/rest/posts';
const LINKEDIN_VERSION = '202601';

const commentary = (input: ProviderPublishInput): string =>
  [input.caption.trim(), input.hashtags.trim(), input.cta.trim(), input.link.trim()].filter(Boolean).join('\n\n');

export class LinkedInService implements SocialProvider {
  async publish(input: ProviderPublishInput): Promise<ProviderPublishResult> {
    if (!input.externalAccountId) throw new Error('LinkedIn member ID is missing.');
    if (!input.accessToken) throw new Error('LinkedIn access token is missing.');
    if (input.imageUrl) throw new Error('LinkedIn image publishing is not enabled in this version; publish text/link posts only.');

    const response = await fetch(LINKEDIN_POSTS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        'Content-Type': 'application/json',
        'X-Restli-Protocol-Version': '2.0.0',
        'LinkedIn-Version': LINKEDIN_VERSION,
      },
      body: JSON.stringify({
        author: `urn:li:person:${input.externalAccountId}`,
        commentary: commentary(input),
        visibility: 'PUBLIC',
        distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
        lifecycleState: 'PUBLISHED',
        isReshareDisabledByAuthor: false,
      }),
    });

    const text = await response.text();
    if (!response.ok) {
      let data: any = {};
      try { data = JSON.parse(text); } catch { /* handled below */ }
      throw new Error(data?.message || data?.error_description || 'LinkedIn publishing failed.');
    }

    const providerId = response.headers.get('x-restli-id') || response.headers.get('X-RestLi-Id');
    if (!providerId) throw new Error('LinkedIn accepted the request but did not return a post ID.');

    return { providerPostId: providerId, publishedAt: new Date() };
  }
}
