import { NextResponse } from "next/server";
import { configured, loadMember, memberValid, sanitize } from "@/lib/roster";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(req:Request) {
  const respond=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{"Cache-Control":"private, no-store"}});
  if(!configured())return respond({error:"الخدمة غير مجهّزة"},503);
  try {
    const data=await req.json() as {id?:string;secret?:string};
    if(typeof data.id!=="string"||typeof data.secret!=="string")return respond({error:"بيانات التعريف غير صالحة"},400);
    const member=await loadMember(data.id);
    if(!member||!memberValid(member,data.secret))return respond({error:"تعذر العثور على اشتراكك"},404);
    return respond({member:sanitize(member)});
  }catch{return respond({error:"تعذر جلب حالة الاشتراك"},503);}
}
