import { env } from '../../../config/env';
import type { ProviderPublishInput, ProviderPublishResult, SocialProvider } from './types';

const baseUrl = (): string => `https://graph.facebook.com/${env.metaGraphApiVersion}`;

const caption = (input: ProviderPublishInput): string =>
  [input.caption.trim(), input.hashtags.trim(), input.cta.trim(), input.link.trim()].filter(Boolean).join('\n\n');

export class InstagramService implements SocialProvider {
  async publish(input: ProviderPublishInput): Promise<ProviderPublishResult> {
    if (!input.externalAccountId) throw new Error('Instagram account ID is missing.');
    if (!input.accessToken) throw new Error('Instagram access token is missing.');
    if (!input.imageUrl) throw new Error('Instagram publishing requires a public image URL.');

    const createBody = new URLSearchParams({
      image_url: input.imageUrl,
      caption: caption(input),
      access_token: input.accessToken,
    });

    const createResponse = await fetch(`${baseUrl()}/${encodeURIComponent(input.externalAccountId)}/media`, {
      method: 'POST',
      body: createBody,
    });
    const createText = await createResponse.text();
    let createData: any = {};
    try { createData = JSON.parse(createText); } catch { /* handled below */ }

    if (!createResponse.ok || !createData?.id) {
      throw new Error(createData?.error?.message || 'Instagram media container creation failed.');
    }

    const publishBody = new URLSearchParams({
      creation_id: String(createData.id),
      access_token: input.accessToken,
    });

    const publishResponse = await fetch(`${baseUrl()}/${encodeURIComponent(input.externalAccountId)}/media_publish`, {
      method: 'POST',
      body: publishBody,
    });
    const publishText = await publishResponse.text();
    let publishData: any = {};
    try { publishData = JSON.parse(publishText); } catch { /* handled below */ }

    if (!publishResponse.ok || !publishData?.id) {
      throw new Error(publishData?.error?.message || 'Instagram publishing failed.');
    }

    return { providerPostId: String(publishData.id), publishedAt: new Date() };
  }
}
