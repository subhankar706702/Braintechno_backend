import { Schema, model } from 'mongoose';
const schema=new Schema({ accountId:{type:Schema.Types.Mixed,required:true,unique:true,sparse:true,index:true}, name:{type:String,required:true,trim:true}, email:{type:String,required:true,unique:true,index:true,lowercase:true,trim:true}, passwordHash:{type:String,required:true}, businessId:{type:Schema.Types.ObjectId,ref:'Business'}, role:{type:String,enum:['owner','admin'],default:'owner'} },{timestamps:true});
export const User=model('User',schema);
