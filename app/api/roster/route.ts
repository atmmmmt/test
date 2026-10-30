import { NextResponse } from "next/server";
import { adminValid, configured, createMember, GROUP_COUNT, inviteValid, listMembers, loadMember, MAX_GROUP, sanitize, saveMember, validName } from "@/lib/roster";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const out = (data: unknown, status=200) => NextResponse.json(data,{status,headers});
const fail = (error:string,status=400) => out({error},status);
async function bodyOf(req:Request) {
  const len=Number(req.headers.get("content-length")||0);
  if(len>12000)throw Error("طلب كبير جداً");
  return await req.json() as Record<string,unknown>;
}
export async function GET(req:Request) {
  if(!configured())return fail("تجهيز نظام التسجيل على الخادم لم يكتمل",503);
  if(!adminValid(req.headers.get("x-umrah-admin")||""))return fail("رمز المسؤول غير صحيح",401);
  try {const people=await listMembers();return out({members:people.map(sanitize),total:people.length});}
  catch{return fail("تعذر تحميل قائمة الأعضاء",503);}
}
export async function POST(req:Request) {
  if(!configured())return fail("تجهيز نظام التسجيل على الخادم لم يكتمل",503);
  try {
    const data=await bodyOf(req);
    if(!inviteValid(String(data.invite||"")))return fail("الرابط غير مخصص لهذه الرحلة",403);
    const name=validName(data.name);
    if(!name)return fail("اكتب اسمك من حرفين إلى 45 حرفاً");
    if(typeof data.volunteered!=="boolean")return fail("اختر مشارك أو منظم");
    const existing=await listMembers();
    if(existing.length>=110)return fail("التسجيل مكتمل. تواصل مع مسؤول الرحلة.",409);
    const created=await createMember(name,data.volunteered);
    return out({...created,success:true},201);
  } catch (e) {return fail(e instanceof SyntaxError?"البيانات غير صالحة":"تعذر إكمال التسجيل. تحقق من الإنترنت وأعد المحاولة.",503);}
}
export async function PATCH(req:Request) {
  if(!configured())return fail("تجهيز نظام التسجيل على الخادم لم يكتمل",503);
  if(!adminValid(req.headers.get("x-umrah-admin")||""))return fail("رمز المسؤول غير صحيح",401);
  try {
    const data=await bodyOf(req);
    const action=String(data.action||"");
    const members=await listMembers();
    if(action==="auto") {
      const sizes=Array.from({length:GROUP_COUNT},(_,i)=>members.filter(m=>m.group===i+1).length);
      const update=members.filter(m=>!m.group).map(m=>{
        const next=sizes.indexOf(Math.min(...sizes));
        if(sizes[next]>=MAX_GROUP)return null;
        sizes[next]++;
        return {...m,group:next+1};
      }).filter((m):m is typeof members[number]=>!!m);
      for(let i=0;i<update.length;i+=10) await Promise.all(update.slice(i,i+10).map(m=>saveMember(m)));
      return out({success:true,assigned:update.length});
    }
    const id=String(data.id||"");
    const person=members.find(m=>m.id===id);
    if(!person)return fail("الشخص غير موجود",404);
    if(action==="group") {
      const group=data.group===null?null:Number(data.group);
      if(group!==null && (!Number.isInteger(group)||group<1||group>GROUP_COUNT))return fail("رقم المجموعة غير صحيح");
      if(group!==null && members.filter(m=>m.id!==id&&m.group===group).length>=MAX_GROUP)return fail("المجموعة ممتلئة");
      person.group=group;
      if(person.captain && group===null)person.captain=false;
      if(person.captain && group!==null && members.some(m=>m.id!==id&&m.group===group&&m.captain))person.captain=false;
    }else if(action==="captain"){
      if(!person.group)return fail("عيّن مجموعة للشخص أولاً");
      if(data.value===true && members.some(m=>m.id!==id&&m.group===person.group&&m.captain))return fail("هناك مسؤول لهذه المجموعة، غيّره أولاً");
      person.captain=data.value===true;
    }else return fail("عملية غير معروفة");
    await saveMember(person);
    return out({success:true,member:sanitize(person)});
  }catch(e){return fail(e instanceof SyntaxError?"بيانات غير صالحة":"تعذر تحديث الشخص، أعد المحاولة.",503);}
}
