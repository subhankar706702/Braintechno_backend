import { Schema, model } from 'mongoose';
const schema = new Schema({ name:{type:String,required:true,trim:true}, slug:{type:String,required:true,unique:true,index:true}, ownerId:{type:Schema.Types.ObjectId,ref:'User'}, status:{type:String,enum:['active','inactive'],default:'active'} },{timestamps:true});
export const Business=model('Business',schema);
