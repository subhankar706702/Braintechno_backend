import 'dotenv/config';
export const env = {
  port: Number(process.env.PORT || 3000),
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/brain-techno',
  jwtSecret: process.env.JWT_SECRET || 'brain-techno-local-development-secret-change-me',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:4200'
};
