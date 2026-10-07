import { SocialPostService } from '../../services/social/social-post.service';

let running = false;
let timer: NodeJS.Timeout | null = null;

export const processScheduledSocialPosts = async (): Promise<number> => {
  if (running) return 0;
  running = true;
  try {
    return await SocialPostService.publishDuePosts();
  } finally {
    running = false;
  }
};

export const startScheduledSocialPostJob = (): void => {
  if (timer) return;
  timer = setInterval(() => {
    void processScheduledSocialPosts().catch(error => {
      console.error('[BRAIN TECHNO] Scheduled social post job failed', error);
    });
  }, 30_000);
  timer.unref();
};
