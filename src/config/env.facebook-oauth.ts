/**
 * Merge these properties into the existing `env` object in src/config/env.ts.
 * Do not replace your existing env configuration.
 */

metaAppId:
  String(process.env.META_APP_ID || '').trim(),

metaAppSecret:
  String(process.env.META_APP_SECRET || '').trim(),

metaFacebookRedirectUri:
  String(
    process.env.META_FACEBOOK_REDIRECT_URI ||
    `${String(
      process.env.BACKEND_URL ||
      `http://localhost:${process.env.PORT || 3000}`
    ).replace(/\/$/, '')}/api/social/oauth/facebook/callback`
  ).trim(),

metaGraphApiVersion:
  String(process.env.META_GRAPH_API_VERSION || 'v26.0').trim(),

socialTokenEncryptionKey:
  String(process.env.SOCIAL_TOKEN_ENCRYPTION_KEY || '').trim(),
