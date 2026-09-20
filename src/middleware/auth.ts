import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
interface TokenPayload { sub:string; businessId?:string; accountId?:string|number; role?:'owner'|'admin'; }
export function requireAuth(req:Request,res:Response,next:NextFunction){
  const raw=req.headers.authorization;
  if(!raw?.startsWith('Bearer ')) return res.status(401).json({message:'Authentication required.'});
  try{
    const payload=jwt.verify(raw.slice(7),env.jwtSecret) as TokenPayload;
    req.auth={userId:payload.sub,businessId:payload.businessId,accountId:payload.accountId ?? '',role:payload.role==='admin'?'admin':'owner'};
    return next();
  }catch{return res.status(401).json({message:'Session is invalid or expired.'});}
}
export function requireAdmin(req:Request,res:Response,next:NextFunction){if(req.auth?.role!=='admin')return res.status(403).json({message:'Admin access required.'});return next();}
