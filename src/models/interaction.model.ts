import { Schema, model } from 'mongoose';
const schema=new Schema({ businessId:{type:Schema.Types.ObjectId,ref:'Business',index:true}, campaignId:{type:Schema.Types.ObjectId,ref:'Campaign',index:true}, event:{type:String,required:true,index:true}, source:{type:String}, metadata:{type:Schema.Types.Mixed} },{timestamps:true});
export const Interaction=model('Interaction',schema);
