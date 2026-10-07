import type { ProviderPublishInput, ProviderPublishResult, SocialProvider } from './types';

export class GoogleBusinessService implements SocialProvider {
  async publish(_input: ProviderPublishInput): Promise<ProviderPublishResult> {
    throw new Error('Google Business Profile publishing is not configured yet. Connect Google Business OAuth before publishing.');
  }
}
