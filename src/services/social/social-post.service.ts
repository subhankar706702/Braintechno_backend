import { Types } from 'mongoose';

import { User } from '../../models/user.model';
import {
  SocialAccount,
  SOCIAL_PLATFORMS,
} from '../../models/social-account.model';

import {
  SocialPost,
  SOCIAL_POST_PLATFORMS,
  SocialPostPlatform,
  SocialPostStatus,
} from '../../models/social-post.model';

const PLATFORM_MAP: Record<
  string,
  SocialPostPlatform
> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  linkedin: 'LinkedIn',
  google_business: 'Google Business Profile',
};

const normalizePlatform = (
  value: unknown,
): SocialPostPlatform | null => {
  const key = String(value ?? '')
    .trim()
    .toLowerCase();

  return PLATFORM_MAP[key] ?? null;
};

const normalizePlatforms = (
  values: unknown,
): SocialPostPlatform[] => {
  if (!Array.isArray(values)) {
    return [];
  }

  const result: SocialPostPlatform[] = [];

  for (const value of values) {
    const normalized =
      normalizePlatform(value);

    if (
      normalized &&
      !result.includes(normalized)
    ) {
      result.push(normalized);
    }
  }

  return result;
};

const getUserContext = async (
  userId: string,
) => {
  const user =
    await User.findById(userId)
      .select('businessId accountId')
      .lean();

  if (!user?.businessId) {
    throw new Error(
      'Your business account is not configured.',
    );
  }

  return {
    businessId:
      String(user.businessId),

    accountId:
      String(user.accountId ?? ''),
  };
};

const ensureConnectedPlatforms = async (
  userId: string,
  businessId: string,
  platforms: SocialPostPlatform[],
) => {
  if (!platforms.length) {
    throw new Error(
      'Select at least one social platform.',
    );
  }

  const connected =
    await SocialAccount.find({
      userId,
      businessId,
      platform: {
        $in: platforms,
      },
      status: 'Connected',
    })
      .select('platform')
      .lean();

  const connectedPlatforms =
    new Set(
      connected.map(
        item => item.platform,
      ),
    );

  const missing =
    platforms.filter(
      platform =>
        !connectedPlatforms.has(
          platform,
        ),
    );

  if (missing.length) {
    throw new Error(
      `The following platform(s) are not connected: ${missing.join(', ')}`,
    );
  }
};

const cleanString = (
  value: unknown,
  maxLength?: number,
): string => {
  const result =
    String(value ?? '').trim();

  if (
    maxLength &&
    result.length > maxLength
  ) {
    return result.slice(0, maxLength);
  }

  return result;
};

const validateLink = (
  value: string,
): void => {
  if (!value) {
    return;
  }

  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    throw new Error(
      'Link must be a valid URL.',
    );
  }

  if (
    parsed.protocol !== 'http:' &&
    parsed.protocol !== 'https:'
  ) {
    throw new Error(
      'Link must use HTTP or HTTPS.',
    );
  }
};

const buildContent = (
  body: any,
) => {
  const caption =
    cleanString(
      body?.content?.caption ??
        body?.caption,
      5000,
    );

  const link =
    cleanString(
      body?.content?.link ??
        body?.link,
      2000,
    );

  const hashtags =
    cleanString(
      body?.content?.hashtags ??
        body?.hashtags,
      2000,
    );

  const cta =
    cleanString(
      body?.content?.cta ??
        body?.cta,
      100,
    );

  validateLink(link);

  return {
    caption,
    link,
    hashtags,
    cta,
  };
};

export const createSocialPost = async ({
  userId,
  body,
  status = 'Draft',
  scheduledAt,
}: {
  userId: string;
  body: any;
  status?: SocialPostStatus;
  scheduledAt?: Date | null;
}) => {
  const {
    businessId,
    accountId,
  } =
    await getUserContext(
      userId,
    );

  const requestedPlatforms =
    Array.isArray(body?.postTo)
      ? body.postTo
      : [];

  let platforms =
    normalizePlatforms(
      requestedPlatforms,
    );

  /*
   * "All Social Media" is resolved against
   * currently connected accounts.
   */
  if (
    body?.postToAll === true
  ) {
    const connected =
      await SocialAccount.find({
        userId,
        businessId,
        status: 'Connected',
      })
        .select('platform')
        .lean();

    platforms =
      connected
        .map(
          item =>
            item.platform,
        )
        .filter(
          platform =>
            SOCIAL_POST_PLATFORMS.includes(
              platform as any,
            ),
        ) as SocialPostPlatform[];
  }

  await ensureConnectedPlatforms(
    userId,
    businessId,
    platforms,
  );

  const content =
    buildContent(body);

  if (
    status !== 'Draft' &&
    !content.caption
  ) {
    throw new Error(
      'Caption is required before publishing or scheduling.',
    );
  }

  if (
    status === 'Scheduled'
  ) {
    if (!scheduledAt) {
      throw new Error(
        'Scheduled date and time are required.',
      );
    }

    if (
      scheduledAt.getTime() <=
      Date.now()
    ) {
      throw new Error(
        'Scheduled time must be in the future.',
      );
    }
  }

  const imageName =
    cleanString(
      body?.media?.original?.name ??
        body?.imageName,
      500,
    );

  const imageUrl =
    cleanString(
      body?.media?.original?.url,
      5000,
    );

  const post =
    await SocialPost.create({
      userId:
        new Types.ObjectId(
          userId,
        ),

      businessId:
        new Types.ObjectId(
          businessId,
        ),

      accountId,

      postTo: platforms,

      content,

      media: {
        original: {
          url: imageUrl,
          name: imageName,
        },
      },

      status,

      scheduledAt:
        scheduledAt ?? null,

      publishedAt: null,

      platformPosts: [],
    });

  return post;
};

export const getSocialPosts = async ({
  userId,
  status,
}: {
  userId: string;
  status?: SocialPostStatus;
}) => {
  const {
    businessId,
  } =
    await getUserContext(
      userId,
    );

  const filter: Record<
    string,
    unknown
  > = {
    userId,
    businessId,
  };

  if (status) {
    filter.status = status;
  }

  return SocialPost.find(
    filter,
  )
    .sort({
      createdAt: -1,
    })
    .lean();
};

export const getSocialPost = async ({
  userId,
  postId,
}: {
  userId: string;
  postId: string;
}) => {
  const {
    businessId,
  } =
    await getUserContext(
      userId,
    );

  if (
    !Types.ObjectId.isValid(
      postId,
    )
  ) {
    throw new Error(
      'Invalid social post ID.',
    );
  }

  const post =
    await SocialPost.findOne({
      _id: postId,
      userId,
      businessId,
    }).lean();

  if (!post) {
    throw new Error(
      'Social post not found.',
    );
  }

  return post;
};

export const updateSocialPost = async ({
  userId,
  postId,
  body,
}: {
  userId: string;
  postId: string;
  body: any;
}) => {
  const {
    businessId,
  } =
    await getUserContext(
      userId,
    );

  if (
    !Types.ObjectId.isValid(
      postId,
    )
  ) {
    throw new Error(
      'Invalid social post ID.',
    );
  }

  const post =
    await SocialPost.findOne({
      _id: postId,
      userId,
      businessId,
    });

  if (!post) {
    throw new Error(
      'Social post not found.',
    );
  }

  if (
    post.status ===
      'Published' ||
    post.status ===
      'Publishing'
  ) {
    throw new Error(
      'Published or currently publishing posts cannot be edited.',
    );
  }

  const platforms =
    normalizePlatforms(
      body?.postTo,
    );

  await ensureConnectedPlatforms(
    userId,
    businessId,
    platforms,
  );

  const content =
    buildContent(body);

  post.postTo =
    platforms;

  post.content =
    content;

  if (
    body?.media?.original
  ) {
    post.media = {
      original: {
        url: cleanString(
          body.media.original.url,
          5000,
        ),

        name: cleanString(
          body.media.original.name,
          500,
        ),
      },
    };
  }

  if (
    body?.status === 'Scheduled'
  ) {
    const scheduledAt =
      new Date(
        String(
          body.scheduledAt ?? '',
        ),
      );

    if (
      Number.isNaN(
        scheduledAt.getTime(),
      )
    ) {
      throw new Error(
        'Invalid scheduled date and time.',
      );
    }

    if (
      scheduledAt.getTime() <=
      Date.now()
    ) {
      throw new Error(
        'Scheduled time must be in the future.',
      );
    }

    post.scheduledAt =
      scheduledAt;

    post.status =
      'Scheduled';
  } else if (
    body?.status === 'Draft'
  ) {
    post.status =
      'Draft';

    post.scheduledAt =
      null;
  }

  await post.save();

  return post.toObject();
};

export const deleteSocialPost = async ({
  userId,
  postId,
}: {
  userId: string;
  postId: string;
}) => {
  const {
    businessId,
  } =
    await getUserContext(
      userId,
    );

  if (
    !Types.ObjectId.isValid(
      postId,
    )
  ) {
    throw new Error(
      'Invalid social post ID.',
    );
  }

  const post =
    await SocialPost.findOne({
      _id: postId,
      userId,
      businessId,
    });

  if (!post) {
    throw new Error(
      'Social post not found.',
    );
  }

  if (
    post.status ===
    'Publishing'
  ) {
    throw new Error(
      'Publishing post cannot be deleted.',
    );
  }

  await post.deleteOne();
};

export const scheduleSocialPost = async ({
  userId,
  postId,
  scheduledAt,
}: {
  userId: string;
  postId: string;
  scheduledAt: Date;
}) => {
  const {
    businessId,
  } =
    await getUserContext(
      userId,
    );

  if (
    scheduledAt.getTime() <=
    Date.now()
  ) {
    throw new Error(
      'Scheduled time must be in the future.',
    );
  }

  const post =
    await SocialPost.findOne({
      _id: postId,
      userId,
      businessId,
    });

  if (!post) {
    throw new Error(
      'Social post not found.',
    );
  }

  if (
    !post.postTo.length
  ) {
    throw new Error(
      'No social platform selected.',
    );
  }

  await ensureConnectedPlatforms(
    userId,
    businessId,
    post.postTo,
  );

  if (
    !post.content.caption.trim()
  ) {
    throw new Error(
      'Caption is required before scheduling.',
    );
  }

  post.status =
    'Scheduled';

  post.scheduledAt =
    scheduledAt;

  await post.save();

  return post.toObject();
};