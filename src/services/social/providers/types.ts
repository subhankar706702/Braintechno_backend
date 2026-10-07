import type { SocialPlatform } from '../../../models/social-account.model';

export interface ProviderPublishInput {
  platform: SocialPlatform;
  externalAccountId: string;
  accessToken: string;
  caption: string;
  link: string;
  hashtags: string;
  cta: string;
  imageUrl: string;
}

export interface ProviderPublishResult {
  providerPostId: string;
  publishedAt: Date;
}

export interface SocialProvider {
  publish(input: ProviderPublishInput): Promise<ProviderPublishResult>;
}
