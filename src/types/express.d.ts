import 'express-serve-static-core';
declare module 'express-serve-static-core' { interface Request { auth?: { userId:string; businessId?:string; accountId:string|number; role:'owner'|'admin'; }; } }
