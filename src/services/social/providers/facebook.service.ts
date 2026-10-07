import { env } from '../../../config/env';
import type { ProviderPublishInput, ProviderPublishResult, SocialProvider } from './types';

const baseUrl = (): string => `https://graph.facebook.com/${env.metaGraphApiVersion}`;

const graphMessage = (input: ProviderPublishInput): string =>
  [input.caption.trim(), input.hashtags.trim(), input.cta.trim()].filter(Boolean).join('\n\n');

export class FacebookService implements SocialProvider {
  async publish(input: ProviderPublishInput): Promise<ProviderPublishResult> {
    if (!input.externalAccountId) throw new Error('Facebook Page ID is missing.');
    if (!input.accessToken) throw new Error('Facebook Page access token is missing.');

    const endpoint = input.imageUrl ? `${baseUrl()}/${encodeURIComponent(input.externalAccountId)}/photos` : `${baseUrl()}/${encodeURIComponent(input.externalAccountId)}/feed`;
    const body = new URLSearchParams();
    body.set('access_token', input.accessToken);

    if (input.imageUrl) body.set('url', input.imageUrl);
    const message = graphMessage(input);
    if (message) body.set('message', message);
    if (input.link && !input.imageUrl) body.set('link', input.link);

    const response = await fetch(endpoint, { method: 'POST', body });
    const text = await response.text();
    let data: any = {};
    try { data = JSON.parse(text); } catch { /* handled below */ }

    if (!response.ok || !data?.id) {
      throw new Error(data?.error?.message || 'Facebook publishing failed.');
    }

    return { providerPostId: String(data.id), publishedAt: new Date() };
  }
}
