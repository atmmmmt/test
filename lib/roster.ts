import "server-only";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { get, list, put } from "@vercel/blob";

const PREFIX = "umrah-live/roster-v1/";
export const GROUP_COUNT = 7;
export const MAX_GROUP = 16;
export type Member = {
  id: string;
  name: string;
  volunteered: boolean;
  group: number | null;
  captain: boolean;
  joinedAt: string;
  updatedAt: string;
  secretHash: string;
};
export type PublicMember = Omit<Member, "secretHash">;
const key = (id: string) => PREFIX + id + ".json";
const hash = (secret: string) => createHash("sha256").update(secret).digest("hex");
export const configured = () => !!process.env.BLOB_READ_WRITE_TOKEN && !!process.env.UMRAH_ADMIN_PIN && !!process.env.UMRAH_JOIN_CODE;
export function adminValid(pin: string): boolean {
  const expected = process.env.UMRAH_ADMIN_PIN || "";
  if (!expected || !pin || pin.length > 200) return false;
  const a = Buffer.from(hash(expected), "hex"), b = Buffer.from(hash(pin), "hex");
  return timingSafeEqual(a,b);
}
export function inviteValid(code: string) {
  const expected = process.env.UMRAH_JOIN_CODE || "";
  if (!expected || !code || code.length > 200) return false;
  return timingSafeEqual(Buffer.from(hash(expected),"hex"),Buffer.from(hash(code),"hex"));
}
export const sanitize = (m: Member): PublicMember => {
  const {secretHash: _hidden, ...rest} = m; void _hidden;
  return rest;
};
export function validName(value: unknown) {
  if(typeof value !== "string") return "";
  const n = value.trim().replace(/\s+/g, " ").replace(/[<>]/g,"");
  return n.length>=2 && n.length<=45 ? n : "";
}
export async function loadMember(id: string) {
  if(!/^[0-9a-f-]{36}$/.test(id)) return null;
  const result = await get(key(id),{access:"private"});
  if(!result) return null;
  return JSON.parse(await new Response(result.stream).text()) as Member;
}
export async function listMembers():Promise<Member[]> {
  let cursor: string|undefined, all:{pathname:string}[]=[];
  do {
    const response=await list({prefix:PREFIX,limit:1000,cursor});
    all.push(...response.blobs);
    cursor=response.hasMore ? response.cursor : undefined;
  }while(cursor && all.length<1000);
  const members:Member[]=[];
  for(let i=0;i<all.length;i+=12){
    const slice=all.slice(i,i+12);
    const loaded=await Promise.all(slice.map(async item => {
      try{ const r=await get(item.pathname,{access:"private"});
        return r ? JSON.parse(await new Response(r.stream).text()) as Member : null;
      }catch{return null;}
    }));
    for(const member of loaded)if(member)members.push(member);
  }
  return members.sort((a,b)=>a.joinedAt.localeCompare(b.joinedAt));
}
export async function createMember(name:string,volunteered:boolean) {
  const id=randomUUID(), secret=randomBytes(24).toString("hex"), now=new Date().toISOString();
  const member:Member={id,name,volunteered,group:null,captain:false,joinedAt:now,updatedAt:now,secretHash:hash(secret)};
  await put(key(id),JSON.stringify(member),{access:"private",contentType:"application/json"});
  return {member:sanitize(member),secret};
}
export async function saveMember(member:Member) {
  member.updatedAt=new Date().toISOString();
  await put(key(member.id),JSON.stringify(member),{access:"private",contentType:"application/json",allowOverwrite:true,cacheControlMaxAge:60});
}
export function memberValid(member:Member,secret:string) {
  return !!secret && secret.length===48 && timingSafeEqual(Buffer.from(member.secretHash,"hex"),Buffer.from(hash(secret),"hex"));
}
