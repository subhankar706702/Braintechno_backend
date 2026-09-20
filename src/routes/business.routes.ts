import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { Business } from '../models/business.model.js';
const router=Router();router.use(requireAuth);
router.get('/',async(req,res,next)=>{try{const item=await Business.findById(req.auth!.businessId).lean();if(!item)return res.status(404).json({message:'Business not found.'});res.json([item]);}catch(e){next(e);}});
router.get('/:id',async(req,res,next)=>{try{if(req.params.id!==req.auth!.businessId)return res.status(403).json({message:'Access denied.'});const item=await Business.findById(req.params.id).lean();if(!item)return res.status(404).json({message:'Business not found.'});res.json(item);}catch(e){next(e);}});
router.put('/:id',async(req,res,next)=>{try{if(req.params.id!==req.auth!.businessId)return res.status(403).json({message:'Access denied.'});const item=await Business.findByIdAndUpdate(req.params.id,{$set:req.body},{new:true,runValidators:true});res.json(item);}catch(e){next(e);}});
export default router;
