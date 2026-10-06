import dotenv from 'dotenv';

dotenv.config();


const required = (
  key: string,
): string => {

  const value =
    String(
      process.env[key] || '',
    ).trim();

  if (!value) {
    throw new Error(
      `Missing required environment variable: ${key}`,
    );
  }

  return value;
};


export const env = {

  port:
    Number(
      process.env.PORT || 3000,
    ),

  frontendUrl:
    String(
      process.env.FRONTEND_URL ||
      'http://localhost:4200',
    ).trim(),

  mongodbUri:
    String(
      process.env.MONGODB_URI ||
      'mongodb://127.0.0.1:27017/brain-techno',
    ).trim(),


  /*
   * Authentication
   */
  jwtSecret:
    required(
      'JWT_SECRET',
    ),


  /*
   * Cloudflare R2
   */
  cloudflareAccountId:
    required(
      'CLOUDFLARE_ACCOUNT_ID',
    ),

  r2AccessKeyId:
    required(
      'R2_ACCESS_KEY_ID',
    ),

  r2SecretAccessKey:
    required(
      'R2_SECRET_ACCESS_KEY',
    ),

  r2BucketName:
    required(
      'R2_BUCKET_NAME',
    ),

  r2PublicUrl:
    String(
      process.env.R2_PUBLIC_URL || '',
    )
      .trim()
      .replace(
        /\/$/,
        '',
      ),

  r2Endpoint:
    String(
      process.env.R2_ENDPOINT || '',
    ).trim(),


  /*
   * Meta / Facebook / Instagram
   */
  metaAppId:
    String(
      process.env.META_APP_ID || '',
    ).trim(),

  metaAppSecret:
    String(
      process.env.META_APP_SECRET || '',
    ).trim(),

  metaGraphApiVersion:
    String(
      process.env.META_GRAPH_API_VERSION ||
      'v26.0',
    ).trim(),

  metaFacebookRedirectUri:
    String(
      process.env.META_FACEBOOK_REDIRECT_URI ||
      '',
    ).trim(),

  metaInstagramRedirectUri:
    String(
      process.env.META_INSTAGRAM_REDIRECT_URI ||
      '',
    ).trim(),

  instagramOAuthScopes:
    String(
      process.env.INSTAGRAM_OAUTH_SCOPES ||
      'instagram_business_basic,instagram_business_content_publish',
    ).trim(),

  facebookOAuthScopes:
    String(
      process.env.FACEBOOK_OAUTH_SCOPES ||
      'pages_show_list,pages_read_engagement,pages_manage_posts',
    ).trim(),


  /*
   * LinkedIn OAuth
   */
  linkedinClientId:
    String(
      process.env.LINKEDIN_CLIENT_ID ||
      '',
    ).trim(),

  linkedinClientSecret:
    String(
      process.env.LINKEDIN_CLIENT_SECRET ||
      '',
    ).trim(),

  linkedinRedirectUri:
    String(
      process.env.LINKEDIN_REDIRECT_URI ||
      '',
    ).trim(),

  linkedinOAuthScopes:
    String(
      process.env.LINKEDIN_OAUTH_SCOPES ||
      'openid profile email w_member_social',
    ).trim(),


  /*
   * Social token encryption.
   *
   * Must be a 64-character hex string.
   */
  socialTokenEncryptionKey:
    String(
      process.env.SOCIAL_TOKEN_ENCRYPTION_KEY ||
      '',
    ).trim(),
};