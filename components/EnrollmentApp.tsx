"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

type Member={id:string;name:string;volunteered:boolean;group:number|null;captain:boolean;joinedAt:string;updatedAt:string};
type Identity={id:string;secret:string;member:Member};
type PromptEvent=Event & {prompt:()=>Promise<void>;userChoice:Promise<{outcome:string}>};
const STORE="umrah-roster-identity-v1";
const INVITE_KEY="umrah-roster-invite";
const GROUPS=[1,2,3,4,5,6,7];
function groupCode(n:number){return "UMRAH-"+String(n).padStart(2,"0");}
async function jsonRequest(path:string,method:string,body?:unknown,pin?:string){
  const response=await fetch(path,{method,headers:{"Content-Type":"application/json",...(pin?{"x-umrah-admin":pin}:{})},body:body===undefined?undefined:JSON.stringify(body),cache:"no-store"});
  const result=await response.json() as Record<string,any>;
  if(!response.ok)throw new Error(String(result.error||"فشل الطلب"));
  return result;
}
function time(value:string){try{return new Date(value).toLocaleTimeString("ar-SY",{hour:"2-digit",minute:"2-digit"});}catch{return "—";}}
export default function EnrollmentApp(){
  const [view,setView]=useState<"join"|"admin">("join");
  const [ready,setReady]=useState(false);
  const [invite,setInvite]=useState("");
  const [name,setName]=useState("");
  const [volunteer,setVolunteer]=useState(false);
  const [identity,setIdentity]=useState<Identity|null>(null);
  const [pending,setPending]=useState(false);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");
  const [online,setOnline]=useState(true);
  const [adminPin,setAdminPin]=useState("");
  const [adminUnlocked,setAdminUnlocked]=useState(false);
  const [members,setMembers]=useState<Member[]>([]);
  const [filter,setFilter]=useState<"all"|"pending"|"captains"|"assigned">("pending");
  const [query,setQuery]=useState("");
  const [savingId,setSavingId]=useState("");
  const [lastSync,setLastSync]=useState("");
  const [installEvent,setInstallEvent]=useState<PromptEvent|null>(null);
  const [isInstalled,setIsInstalled]=useState(false);
  const [showInstallHelp,setShowInstallHelp]=useState(false);
  const [inviteForSharing,setInviteForSharing]=useState("");
  const syncing=useRef(false);
  const ios=typeof navigator!=="undefined"&&/iPad|iPhone|iPod/.test(navigator.userAgent);
  useEffect(()=>{
    setReady(true);setOnline(navigator.onLine);
    const saved=localStorage.getItem(STORE);
    if(saved){try{const value=JSON.parse(saved) as Identity;if(value.id&&value.secret&&value.member)setIdentity(value);}catch{}}
    const code=new URLSearchParams(window.location.search).get("invite")||localStorage.getItem(INVITE_KEY)||"";
    if(code){setInvite(code);localStorage.setItem(INVITE_KEY,code);}
    const standalone=window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & {standalone?:boolean}).standalone===true;
    setIsInstalled(standalone);
    const handler=(event:Event)=>{event.preventDefault();setInstallEvent(event as PromptEvent);};
    const connectivity=()=>setOnline(navigator.onLine);
    window.addEventListener("beforeinstallprompt",handler);
    window.addEventListener("online",connectivity);window.addEventListener("offline",connectivity);
    navigator.serviceWorker?.register("/sw.js").catch(()=>{});
    return ()=>{window.removeEventListener("beforeinstallprompt",handler);window.removeEventListener("online",connectivity);window.removeEventListener("offline",connectivity);};
  },[]);
  async function refreshMe(){
    if(!identity||!navigator.onLine||syncing.current)return;
    syncing.current=true;
    try{const result=await jsonRequest("/api/me","POST",{id:identity.id,secret:identity.secret});
      const next={...identity,member:result.member as Member};setIdentity(next);localStorage.setItem(STORE,JSON.stringify(next));setLastSync(new Date().toLocaleTimeString("ar-SY",{hour:"2-digit",minute:"2-digit"}));
    }catch{}finally{syncing.current=false;}
  }
  useEffect(()=>{if(!ready||!identity||!online)return;void refreshMe();const t=setInterval(()=>void refreshMe(),30000);return()=>clearInterval(t);},[ready,identity?.id,online]);
  async function register(){
    setError("");setMessage("");const valid=name.trim().replace(/\s+/g," ");
    if(valid.length<2||valid.length>45){setError("اكتب اسمك بشكل صحيح، من حرفين إلى 45 حرفاً.");return;}
    if(!invite.trim()){setError("افتح رابط الدعوة الذي أرسله مسؤول الرحلة.");return;}
    if(!navigator.onLine){
      setPending(true);localStorage.setItem("umrah-roster-pending",JSON.stringify({name:valid,volunteered:volunteer,invite}));
      setMessage("تم حفظ طلبك على هذا الهاتف فقط. لم يصل للمسؤول بعد؛ افتح التطبيق عند توفر الإنترنت لإرساله.");
      return;
    }
    setBusy(true);
    try{const result=await jsonRequest("/api/roster","POST",{name:valid,volunteered:volunteer,invite:invite.trim()});
      const next:Identity={id:result.member.id,secret:result.secret,member:result.member};
      setIdentity(next);localStorage.setItem(STORE,JSON.stringify(next));localStorage.removeItem("umrah-roster-pending");setPending(false);setMessage("تم استلام التسجيل بنجاح. المسؤول سيوزّعك على مجموعتك.");
    }catch(e){setError(e instanceof Error?e.message:"تعذّر التسجيل");}finally{setBusy(false);}
  }
  useEffect(()=>{if(!ready||identity||!online)return;const raw=localStorage.getItem("umrah-roster-pending");if(!raw)return;try{const p=JSON.parse(raw);setName(p.name||"");setVolunteer(!!p.volunteered);setInvite(p.invite||"");setPending(true);}catch{}},[ready,identity?.id,online]);
  async function loadAdmin(pin=adminPin){
    if(!pin.trim()||!navigator.onLine){setError("لوحة الإدارة تحتاج إنترنت ورمز المسؤول.");return;}
    setBusy(true);setError("");
    try{const result=await jsonRequest("/api/roster","GET",undefined,pin.trim());
      setMembers(result.members as Member[]);setAdminUnlocked(true);
      sessionStorage.setItem("umrah-admin-pin",pin.trim());setLastSync(new Date().toLocaleTimeString("ar-SY",{hour:"2-digit",minute:"2-digit"}));
      if(result.invite)setInviteForSharing(result.invite as string);
    }catch(e){setError(e instanceof Error?e.message:"تعذّر فتح الإدارة");}finally{setBusy(false);}
  }
  useEffect(()=>{if(view!=="admin"||adminUnlocked||!ready)return;try{const saved=sessionStorage.getItem("umrah-admin-pin");if(saved){setAdminPin(saved);void loadAdmin(saved);}}catch{}},[view,ready,adminUnlocked]);
  useEffect(()=>{if(view!=="admin"||!adminUnlocked||!online)return;const t=setInterval(()=>void loadAdmin(adminPin),30000);return()=>clearInterval(t);},[view,adminUnlocked,adminPin,online]);
  async function edit(id:string,action:string,value:unknown){
    setSavingId(id);setError("");
    try{await jsonRequest("/api/roster","PATCH",{id,action,...(action==="group"?{group:value}:action==="captain"?{value}:{})},adminPin);
      await loadAdmin(adminPin);
    }catch(e){setError(e instanceof Error?e.message:"تعذّر تحديث الشخص");}finally{setSavingId("");}
  }
  async function autoSort(){
    if(!window.confirm("توزيع المسجلين الذين لم تعيّن لهم مجموعة على المجموعات السبع؟"))return;
    setSavingId("auto");setError("");
    try{const r=await jsonRequest("/api/roster","PATCH",{action:"auto"},adminPin);await loadAdmin(adminPin);setMessage("تم توزيع "+r.assigned+" مشاركاً.");}
    catch(e){setError(e instanceof Error?e.message:"تعذّر التوزيع");}finally{setSavingId("");}
  }
  function exportCsv(){
    const data=[["الاسم","تطوع للتنظيم","المجموعة","مسؤول المجموعة","وقت التسجيل"],...members.map(m=>[m.name,m.volunteered?"نعم":"لا",m.group?groupCode(m.group):"بانتظار",m.captain?"نعم":"لا",m.joinedAt])];
    const contents="\uFEFF"+data.map(row=>row.map(x=>'"'+String(x).replace(/"/g,'""')+'"').join(",")).join("\r\n");
    const file=new Blob([contents],{type:"text/csv;charset=utf-8"});const url=URL.createObjectURL(file);const a=document.createElement("a");a.href=url;a.download="umrah-participants.csv";a.click();URL.revokeObjectURL(url);
  }
  async function copy(value:string){
    try{await navigator.clipboard.writeText(value);setMessage("تم نسخ الرابط.");}catch{setMessage("تعذّر النسخ، اضغط مطولاً لنسخ الرابط.");}
  }
  async function install(){
    if(installEvent){await installEvent.prompt();const choice=await installEvent.userChoice;if(choice.outcome==="accepted")setInstallEvent(null);}
    else setShowInstallHelp(v=>!v);
  }
  const counts=GROUPS.map(g=>({group:g,people:members.filter(m=>m.group===g),captain:members.find(m=>m.group===g&&m.captain)}));
  const filtered=useMemo(()=>members.filter(m=>(filter==="pending"?!m.group:filter==="assigned"?!!m.group:filter==="captains"?m.volunteered||m.captain:true)&&(!query.trim()||m.name.includes(query.trim())||(m.group&&groupCode(m.group).includes(query.toUpperCase())))),[members,filter,query]);
  const registrationUrl=inviteForSharing&&typeof window!=="undefined"?window.location.origin+"/?invite="+encodeURIComponent(inviteForSharing):"";
  return <main className="en-app" dir="rtl">
    <header className="en-top"><div className="en-mark">۞</div><div className="en-title"><strong>رفقة العمرة</strong><small>UMRAH • CONNECT</small></div><div className="en-top-end"><span className={"en-network "+(online?"en-network-on":"")}>{online?"متصل":"بدون إنترنت"}</span></div></header>
    <section className="en-hero"><div className="en-overline">رحلة واحدة • رفقة واحدة</div><h1>من أول خطوة،<br/><em>كلنا مع بعض.</em></h1><p>سجّل اسمك بكل سهولة، ومسؤول الرحلة بيضيفك لمجموعتك. هويتك ومجموعتك بتضل محفوظة بالتطبيق.</p><div className="en-hero-stats"><span><b>07</b> مجموعات</span><span><b>100</b> مشارك مستهدف</span><span><b>01</b> رفقة</span></div></section>
    <nav className="en-tabs" aria-label="القسم"><button className={view==="join"?"active":""} onClick={()=>{setView("join");setError("");}}>أنا مشارك</button><button className={view==="admin"?"active":""} onClick={()=>{setView("admin");setError("");}}>لوحة مسؤول الرحلة</button></nav>
    {view==="join"&&<section className="en-card">
      {!identity?<><div className="en-section-head"><span className="en-number">01</span><div><h2>انضم إلى رفقة العمرة</h2><p>ما بدك حساب ولا كلمة مرور. بس اكتب اسمك.</p></div></div>
        <label className="en-label">اسمك الكامل<input value={name} maxLength={45} onChange={e=>setName(e.target.value)} placeholder="مثلاً: أحمد محمد" autoComplete="name"/></label>
        <div className="en-caption-label">كيف بتحب تشارك بالرحلة؟</div><div className="en-role-grid"><button className={!volunteer?"selected":""} onClick={()=>setVolunteer(false)}><span>◉</span><b>مشارك</b><small>بدي انضم لمجموعة</small></button><button className={volunteer?"selected":""} onClick={()=>setVolunteer(true)}><span>✦</span><b>متطوع للتنظيم</b><small>المسؤول بيحدد دوري</small></button></div>
        {!invite&&<label className="en-label">رمز دعوة الرحلة<input value={invite} onChange={e=>setInvite(e.target.value)} placeholder="اكتب الرمز الموجود مع المسؤول"/></label>}
        <button className="en-primary" disabled={busy} onClick={()=>void register()}>{busy?"جاري تسجيلك...":"تسجيل اسمي في المجموعة"}</button>
        {pending&&<p className="en-info">في طلب محفوظ على جهازك؛ اضغط زر التسجيل عند توفر الإنترنت لإرساله فعلياً.</p>}
      </>:<><div className="en-section-head"><span className="en-number">✓</span><div><h2>أهلاً {identity.member.name}</h2><p>تم تسجيل اسمك ضمن طلبات المجموعة.</p></div></div>
        <div className="en-my-status"><div><span>حالة الطلب</span><strong>{identity.member.group?"تم تحديد المجموعة":"بانتظار التوزيع"}</strong></div><span className={"en-status-circle "+(identity.member.group?"done":"")} /></div>
        {identity.member.group?<div className="en-assignment"><span>مجموعتك بالرحلة</span><strong>{groupCode(identity.member.group)}</strong><p>{identity.member.captain?"أنت مسؤول هذه المجموعة":"التوزيع من مسؤول الرحلة"} · احتفظ بالتطبيق مثبتاً لتشوف مجموعتك حتى لو انقطع الإنترنت.</p></div>:<div className="en-empty">المسؤول عم يرتّب الأسماء والمجموعات. افتح التطبيق لاحقاً أو اضغط تحديث.</div>}
        <button className="en-secondary" disabled={!online} onClick={()=>void refreshMe()}>تحديث مجموعتي</button>{lastSync&&<p className="en-timestamp">آخر تحديث: {lastSync}</p>}
      </>}
    </section>}
    {view==="admin"&&<section className="en-card">
      <div className="en-section-head"><span className="en-number">✦</span><div><h2>لوحة مسؤول الرحلة</h2><p>راقب التسجيلات، وزّع المشاركين، وعيّن مسؤولي المجموعات.</p></div></div>
      {!adminUnlocked?<><label className="en-label">رمز دخول المسؤول<input type="password" value={adminPin} onChange={e=>setAdminPin(e.target.value)} placeholder="رمز المسؤول الخاص" autoComplete="off"/></label><button className="en-primary" disabled={busy||!online} onClick={()=>void loadAdmin()}>{busy?"جارٍ التحقق...":"دخول الإدارة"}</button></>:<>
        <div className="en-counters"><div><strong>{members.length}</strong><span>مسجّل</span></div><div><strong>{members.filter(m=>!m.group).length}</strong><span>بانتظار الفرز</span></div><div><strong>{members.filter(m=>m.group).length}</strong><span>تم توزيعهم</span></div><div><strong>{members.filter(m=>m.captain).length}</strong><span>منظمون</span></div></div>
        <div className="en-manager-actions"><button onClick={()=>void autoSort()} disabled={savingId!==""}>فرز تلقائي متوازن</button><button onClick={()=>void loadAdmin(adminPin)} disabled={busy}>تحديث القائمة</button><button onClick={exportCsv}>تصدير Excel CSV</button></div>
        {registrationUrl&&<div className="en-invitation"><div className="en-invitation-text"><strong>رابط انضمام المشاركين</strong><p>شارك الرابط مع الجميع. الرمز موجود ضمنه، فما بيحتاجوا يكتبوا أي رمز.</p><input readOnly value={registrationUrl} dir="ltr" aria-label="رابط الدعوة"/><button className="en-secondary" onClick={()=>void copy(registrationUrl)}>نسخ رابط الدعوة</button></div><div className="en-invitation-qr"><QRCodeSVG value={registrationUrl} size={117} level="M" bgColor="#fff" fgColor="#14332E"/></div></div>}
        <div className="en-group-dashboard">{counts.map(g=><div key={g.group} className="en-group-stat"><b>{String(g.group).padStart(2,"0")}</b><strong>{g.people.length}<small> / 16</small></strong><span>{g.captain?"مسؤول: "+g.captain.name:"بدون مسؤول"}</span><div className="en-progress"><i style={{width:(g.people.length/16*100)+"%"}}/></div></div>)}</div>
        <div className="en-section-row"><h3>أسماء المشاركين</h3><span>{filtered.length} اسم</span></div>
        <input className="en-search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="بحث باسم الشخص أو المجموعة"/>
        <div className="en-filter">{([["pending","غير موزعين"],["all","الجميع"],["captains","متطوعون"],["assigned","موزعون"]] as const).map(([id,label])=><button key={id} className={filter===id?"active":""} onClick={()=>setFilter(id)}>{label}</button>)}</div>
        <div className="en-list">{filtered.length?filtered.map(m=><article key={m.id} className="en-person"><div className="en-avatar">{m.name.slice(0,2)}</div><div className="en-person-info"><strong>{m.name}</strong><small>{m.volunteered?"متطوع للتنظيم":"مشارك"} · {time(m.joinedAt)}</small><span>{m.group?groupCode(m.group):"بانتظار المجموعة"}{m.captain?" · مسؤول المجموعة":""}</span></div><div className="en-person-controls"><select aria-label={"مجموعة "+m.name} value={m.group??""} disabled={savingId!==""} onChange={e=>void edit(m.id,"group",e.target.value?Number(e.target.value):null)}><option value="">غير موزع</option>{GROUPS.map(g=><option value={g} key={g}>{groupCode(g)}</option>)}</select><label className="en-captain-toggle"><input type="checkbox" checked={m.captain} disabled={!m.group||savingId!==""} onChange={e=>void edit(m.id,"captain",e.target.checked)}/> مسؤول</label></div></article>):<div className="en-empty">ما في أسماء مطابقة حالياً.</div>}</div>
        <button className="en-admin-logout" onClick={()=>{setAdminUnlocked(false);setMembers([]);setAdminPin("");sessionStorage.removeItem("umrah-admin-pin");}}>تسجيل خروج المسؤول</button>
      </>}
    </section>}
    {error&&<div className="en-error" role="alert">{error}</div>}
    {message&&<div className="en-info" role="status">{message}</div>}
    <section className="en-install"><div><span className="en-overline">تطبيقك جاهز على موبايلك</span><h2>ثبّت رفقة العمرة على الشاشة الرئيسية</h2><p>بيفتح كأنه تطبيق مستقل، وبيرجع يعرض آخر مجموعة محفوظة حتى لو ما في إنترنت.</p></div><button className="en-install-btn" disabled={isInstalled} onClick={()=>void install()}>{isInstalled?"✓ التطبيق مثبت":"تثبيت التطبيق"}</button>
    {showInstallHelp&&<p className="en-install-help">{ios?"على آيفون: افتح الموقع في Safari، اضغط مشاركة، ثم «إضافة إلى الشاشة الرئيسية».":"من قائمة المتصفح ⋮ اختر «تثبيت التطبيق» أو «إضافة للشاشة الرئيسية». المتصفح قد يطلب منك تأكيد التثبيت."}</p>}</section>
    <footer className="en-footer">هذا التطبيق لتنظيم الرحلة وتوزيع المشاركين. التسجيل والفرز بين الأجهزة يحتاجان إنترنت قبل الرحلة. لا ينقل صوتاً مباشراً عبر Bluetooth Mesh دون شبكة مشتركة.</footer>
  </main>;
}
