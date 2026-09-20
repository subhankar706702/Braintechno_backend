import { Schema, model } from 'mongoose';
const schema = new Schema({ key:{type:String,required:true,unique:true}, seq:{type:Number,required:true,default:0} },{versionKey:false});
export const Counter=model('Counter',schema);
