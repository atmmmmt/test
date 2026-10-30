"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

type Role = "speaker" | "relay" | "listener";
type Phase = "idle" | "preparing" | "ready" | "connected" | "failed";
type Signal = { v: 2; type: "offer" | "answer"; link: string; session: string; sdp: string };
type Link = { id: string; pc: RTCPeerConnection; direction: "up" | "down"; label: string };
type LinkInfo = { id: string; direction: "up" | "down"; state: string; label: string };
type Inbox = { id: string; total: number; chunks: Map<number, string> };
const CHUNK = 430;
const iceConfig: RTCConfiguration = { iceServers: [], iceCandidatePoolSize: 0 };
function key() { return Math.random().toString(36).slice(2, 10); }
function encode(bytes: Uint8Array) {
  let s = ""; for (let i = 0; i < bytes.length; i += 4096) s += String.fromCharCode(...bytes.slice(i, i + 4096));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function decode(s: string) {
  const t = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4-s.length%4)%4));
  return Uint8Array.from(t, c => c.charCodeAt(0));
}
async function pack(sig: Signal) {
  const data = new TextEncoder().encode(JSON.stringify(sig));
  if (typeof CompressionStream !== "undefined") {
    const output = new Blob([new Uint8Array(data)]).stream().pipeThrough(new CompressionStream("gzip"));
    return "G"+encode(new Uint8Array(await new Response(output).arrayBuffer()));
  }
  return "R"+encode(data);
}
async function unpack(value: string): Promise<Signal> {
  if (value.length > 100000 || !/^[GR][A-Za-z0-9_-]+$/.test(value)) throw Error("رمز الربط غير صالح");
  const bytes = decode(value.slice(1));
  if (value[0] === "G" && typeof DecompressionStream === "undefined") throw Error("المتصفح لا يدعم فك الضغط؛ جرّب تحديثه");
  const raw = value[0] === "G"
    ? await new Response(new Blob([new Uint8Array(bytes)]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer()
    : new Uint8Array(bytes).buffer;
  const x = JSON.parse(new TextDecoder().decode(raw)) as Signal;
  if (x.v !== 2 || !["offer","answer"].includes(x.type) || typeof x.sdp !== "string" || !x.sdp.startsWith("v=0") || typeof x.link !== "string" || typeof x.session !== "string") throw Error("رمز الربط غير مطابق لهذا التطبيق");
  return x;
}
function toFrames(payload: string) {
  const id = key(), parts = payload.match(new RegExp(".{1,"+CHUNK+"}", "g")) || [];
  return parts.map((part,i) => "UM2|"+id+"|"+(i+1)+"|"+parts.length+"|"+part);
}
async function gather(pc: RTCPeerConnection) {
  if (pc.iceGatheringState === "complete") return;
  await new Promise<void>((resolve,reject) => {
    const cleanup = () => { window.clearTimeout(timer); pc.removeEventListener("icegatheringstatechange",check); };
    const check = () => { if (pc.iceGatheringState === "complete") { cleanup(); resolve(); } };
    const timer = window.setTimeout(() => { cleanup(); reject(Error("انتهت مهلة تجهيز الاتصال؛ جرّب مجدداً")); }, 20000);
    pc.addEventListener("icegatheringstatechange",check);
  });
}
function messageOf(e: unknown) {
  if (e instanceof DOMException && e.name === "NotAllowedError") return "اسمح باستخدام الميكروفون أو الكاميرا من إعدادات الجهاز.";
  return e instanceof Error ? e.message : "حدث خطأ غير متوقع";
}
export default function GroupApp() {
  const [role,setRole] = useState<Role | null>(null);
  const [session,setSession] = useState("");
  const [phase,setPhase] = useState<Phase>("idle");
  const [notice,setNotice] = useState("اختر دورك للبدء");
  const [error,setError] = useState("");
  const [outbound,setOutbound] = useState<string[]>([]);
  const [page,setPage] = useState(0);
  const [inboundProgress,setInboundProgress] = useState("");
  const [links,setLinks] = useState<LinkInfo[]>([]);
  const [scan,setScan] = useState(false);
  const [manual,setManual] = useState("");
  const [showAdvanced,setShowAdvanced] = useState(false);
  const [audioReady,setAudioReady] = useState(false);
  const [isPlaying,setIsPlaying] = useState(false);
  const [muted,setMuted] = useState(false);
  const [swReady,setSwReady] = useState(false);
  const [quality,setQuality] = useState("");
  const [network,setNetwork] = useState("فحص الاتصال المحلي يتطلب تجربة فعلية");
  const peers = useRef(new Map<string,Link>());
  const upstream = useRef<string | null>(null);
  const waiting = useRef<string | null>(null);
  const speakerStream = useRef<MediaStream | null>(null);
  const forwardedStream = useRef<MediaStream | null>(null);
  const sourceSession = useRef("");
  const roleCurrent = useRef<Role | null>(null);
  const inbox = useRef<Inbox | null>(null);
  const busy = useRef(false);
  const callback = useRef<(input:string)=>Promise<void>>(async()=>{});
  const audio = useRef<HTMLAudioElement | null>(null);
  const video = useRef<HTMLVideoElement | null>(null);
  const camera = useRef<{stop:()=>void} | null>(null);
  const generated = useRef("");
  const closeCamera = useCallback(() => { camera.current?.stop(); camera.current=null; setScan(false); }, []);
  const refresh = useCallback(() => {
    setLinks([...peers.current.values()].map(x => ({id:x.id,direction:x.direction,state:x.pc.connectionState,label:x.label})));
  },[]);
  const stop = useCallback(() => {
    closeCamera();
    peers.current.forEach(x=>x.pc.close()); peers.current.clear();
    speakerStream.current?.getTracks().forEach(t=>t.stop()); speakerStream.current=null;
    forwardedStream.current=null; upstream.current=null; waiting.current=null;
    sourceSession.current=""; generated.current=""; inbox.current=null;
    if (audio.current) {audio.current.pause();audio.current.srcObject=null;}
    setLinks([]);setAudioReady(false);setIsPlaying(false);setMuted(false);
    setOutbound([]);setPage(0);setError("");setQuality("");setSession("");setPhase("idle");
  },[closeCamera]);
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").then(async () => {
        await navigator.serviceWorker.ready;
        await import("@zxing/browser");
        setSwReady(true);
      }).catch(()=>setSwReady(false));
    }
    return () => {camera.current?.stop();peers.current.forEach(x=>x.pc.close());speakerStream.current?.getTracks().forEach(t=>t.stop());};
  },[]);
  useEffect(() => {
    const timer = window.setInterval(async () => {
      const active = [...peers.current.values()].find(p=>p.pc.connectionState==="connected" && p.direction==="up");
      if (!active) {setQuality("");return;}
      try {
        const stats = await active.pc.getStats(); let loss=0,received=0,jitter=0;
        stats.forEach(r=>{if(r.type==="inbound-rtp" && r.kind==="audio"){loss+=r.packetsLost||0;received+=r.packetsReceived||0;jitter=Math.max(jitter,r.jitter||0);}});
        if(received) setQuality("حزم مستلمة "+received+" · فقد "+(100*loss/(received+loss)).toFixed(1)+"% · اهتزاز "+Math.round(jitter*1000)+"ms");
      } catch {}
    },5000);
    return ()=>window.clearInterval(timer);
  },[]);
  function choose(r:Role) {
    stop(); roleCurrent.current=r;setRole(r);
    setNotice(r==="speaker"?"افتح الميكروفون وابدأ الجلسة":r==="relay"?"امسح رمز الجهاز المصدر أولاً":"امسح رمز الشيخ أو جهاز وسيط للاستماع");
  }
  function attachPeer(link:Link) {
    peers.current.set(link.id,link);refresh();
    link.pc.onconnectionstatechange = () => {
      refresh();
      if (link.pc.connectionState==="connected") {setPhase("connected");setNotice("الاتصال المحلي يعمل");setNetwork("تم الاتصال الفعلي عبر WebRTC");}
      if (link.pc.connectionState==="failed" || link.pc.connectionState==="disconnected") {setNotice("انقطع أحد الاتصالات، أعد ربط الجهاز");setPhase("failed");}
    };
    link.pc.oniceconnectionstatechange = () => { if(link.pc.iceConnectionState==="failed") setError("فشل الوصول عبر الشبكة المحلية. تأكد من Wi-Fi مشترك وسماح الأجهزة بالتواصل."); };
  }
  async function showSignal(s:Signal) { generated.current=await pack(s);setOutbound(toFrames(generated.current));setPage(0);setPhase("ready");}
  async function startBroadcast() {
    setError("");try {
      if(!navigator.mediaDevices?.getUserMedia) throw Error("افتح التطبيق على HTTPS للحصول على إذن الميكروفون");
      const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
      speakerStream.current=stream;sourceSession.current=key().toUpperCase();setSession(sourceSession.current);
      setPhase("ready");setNotice("الميكروفون يعمل؛ أضف الآن مستمعاً أو جهازاً وسيطاً");
    }catch(e){setError(messageOf(e));}
  }
  async function addChild() {
    const stream=roleCurrent.current==="speaker"?speakerStream.current:forwardedStream.current;
    if(!stream?.getAudioTracks().length){setError("لا يوجد صوت مباشر متاح لتمريره. اتصل أولاً بالجهاز المصدر.");return;}
    if(waiting.current){setError("أكمل ربط الجهاز السابق قبل إضافة جهاز جديد");return;}
    setError("");setPhase("preparing");
    const id=key(),pc=new RTCPeerConnection(iceConfig);
    try {
      attachPeer({id,pc,direction:"down",label:"مستمع / وسيط "+(peers.current.size+1)});
      stream.getAudioTracks().forEach(t=>pc.addTrack(t,stream));
      const offer=await pc.createOffer();await pc.setLocalDescription(offer);await gather(pc);
      if(!pc.localDescription) throw Error("تعذر تكوين دعوة");
      waiting.current=id;
      await showSignal({v:2,type:"offer",link:id,session:sourceSession.current,sdp:pc.localDescription.sdp});
      setNotice("اعرض رموز الدعوة على الجهاز الجديد، ثم امسح منه رموز الرد");
    } catch(e) {pc.close();peers.current.delete(id);refresh();setError(messageOf(e));setPhase("failed");}
  }
  async function onSignal(s:Signal) {
    if(s.type==="offer"){
      if(roleCurrent.current==="speaker") throw Error("الشيخ يستقبل ردود الاتصال، وليس دعوات جديدة");
      if(upstream.current) throw Error("أنت متصل بمصدر بالفعل. أنهِ الجلسة أولاً لتغيير المصدر.");
      const pc=new RTCPeerConnection(iceConfig);
      try{
        upstream.current=s.link;sourceSession.current=s.session;setSession(s.session);
        attachPeer({id:s.link,pc,direction:"up",label:"مصدر الصوت"});
        pc.ontrack=(event)=>{
          const stream=event.streams[0]||new MediaStream([event.track]);
          forwardedStream.current=stream;
          if(audio.current) audio.current.srcObject=stream;
          setAudioReady(true);setNotice("وصلت قناة الصوت؛ اضغط تشغيل الصوت للاستماع");
        };
        await pc.setRemoteDescription({type:"offer",sdp:s.sdp});
        const answer=await pc.createAnswer();await pc.setLocalDescription(answer);await gather(pc);
        if(!pc.localDescription) throw Error("تعذر تجهيز الرد");
        await showSignal({v:2,type:"answer",link:s.link,session:s.session,sdp:pc.localDescription.sdp});
        setNotice("اعرض رموز الرد على الجهاز الذي أرسل الدعوة");
      }catch(e){pc.close();peers.current.delete(s.link);upstream.current=null;refresh();throw e;}
    }else{
      const link=peers.current.get(s.link);
      if(!link||link.direction!=="down"||link.id!==waiting.current) throw Error("هذا الرد لا يخص دعوة الاتصال الحالية");
      if(s.session!==sourceSession.current) throw Error("رمز الرد من جلسة مختلفة");
      await link.pc.setRemoteDescription({type:"answer",sdp:s.sdp});
      waiting.current=null;setOutbound([]);generated.current="";setPage(0);
      setNotice("تم استلام الرد؛ انتظر ظهور حالة الاتصال");
    }
  }
  async function handleToken(value:string){
    if(busy.current) return;
    try{
      const raw=value.trim();
      if(raw.startsWith("UM2FULL:")){
        busy.current=true;closeCamera();await onSignal(await unpack(raw.slice(8)));
        setInboundProgress("وصلت معلومات الاتصال كاملة ✓");return;
      }
      const m=/^UM2\|([a-z0-9]+)\|(\d+)\|(\d+)\|([A-Za-z0-9_-]+)$/.exec(raw);
      if(!m) throw Error("رمز غير معروف. استخدم رمزاً من رفقة العمرة.");
      const [,id,n,total,chunk]=m,idx=Number(n),count=Number(total);
      if(count<1||count>100||idx<1||idx>count) throw Error("رمز QR غير صالح");
      if(!inbox.current||inbox.current.id!==id) inbox.current={id,total:count,chunks:new Map()};
      if(inbox.current.total!==count) throw Error("رموز مختلفة");
      inbox.current.chunks.set(idx,chunk);
      setInboundProgress("تم مسح "+inbox.current.chunks.size+" من "+count+" رمز");
      if(inbox.current.chunks.size===count){
        busy.current=true;const joined=Array.from({length:count},(_,i)=>inbox.current!.chunks.get(i+1)||"").join("");
        closeCamera();await onSignal(await unpack(joined));inbox.current=null;setInboundProgress("تم الاستلام بنجاح ✓");
      }
    }catch(e){setError(messageOf(e));}finally{busy.current=false;}
  }
  callback.current=handleToken;
  useEffect(()=>{
    if(!scan)return;let cancelled=false;
    (async()=>{try{
      const {BrowserQRCodeReader}=await import("@zxing/browser");
      const reader=new BrowserQRCodeReader(undefined,{delayBetweenScanAttempts:500});
      if(!video.current)throw Error("الكاميرا غير جاهزة");
      const c=await reader.decodeFromConstraints({audio:false,video:{facingMode:{ideal:"environment"}}},video.current,r=>{if(r)void callback.current(r.getText());});
      if(cancelled)c.stop();else camera.current=c;
    }catch(e){if(!cancelled){setScan(false);setError(messageOf(e));}}})();
    return ()=>{cancelled=true;camera.current?.stop();camera.current=null;};
  },[scan]);
  async function play(){
    try{if(!audio.current) return;await audio.current.play();setIsPlaying(true);setError("");}catch(e){setError("اضغط تشغيل الصوت وتحقق من إعدادات الجهاز. "+messageOf(e));}
  }
  function toggleMute() {
    const track=speakerStream.current?.getAudioTracks()[0];
    if(track){track.enabled=!track.enabled;setMuted(!track.enabled);}
  }
  const down=links.filter(x=>x.direction==="down");
  const connected=down.filter(x=>x.state==="connected").length;
  const available=role==="speaker"?!!speakerStream.current:role==="relay"?!!forwardedStream.current:false;
  return <main className="group" dir="rtl">
    <header className="gc-header"><div className="gc-brand"><span className="gc-emblem">☪</span><div><strong>رفقة العمرة</strong><small>UMRAH CONNECT · LIVE</small></div></div><span className="gc-live"><i/> بث مباشر فقط</span></header>
    <section className="gc-hero"><span className="gc-eyebrow">معاً في كل دعاء</span><h1>صوت الشيخ <em>يوصلك مباشرة.</em></h1><p>استماع مباشر بدون تسجيلات. تحتاج الأجهزة إلى شبكة Wi‑Fi محلية مشتركة حتى لو ما فيها إنترنت. هذا الإصدار يتيح ربط عدة أجهزة يدوياً، ولا يضمن مئة اتصال.</p></section>
    <div className="gc-banner">مهم: التطبيق لا ينشئ شبكة Bluetooth Mesh من المتصفح. بدون Wi-Fi محلي أو مسار اتصال مشترك لن يصل الصوت. يجب تثبيت التطبيق مسبقاً أثناء توفر الإنترنت.</div>
    <section className="gc-roles">
      {([{r:"speaker",icon:"🎙",title:"الشيخ",desc:"إرسال الدعاء مباشرة"},{r:"relay",icon:"🔗",title:"جهاز وسيط",desc:"استقبال الصوت وتمريره"},{r:"listener",icon:"🎧",title:"مستمع",desc:"سماع الدعاء المباشر"}] as const).map(x=><button key={x.r} className={"gc-role "+(role===x.r?"active":"")} onClick={()=>choose(x.r)}><span>{x.icon}</span><strong>{x.title}</strong><small>{x.desc}</small></button>)}
    </section>
    {role&&<section className="gc-panel">
      <div className="gc-panelhead"><div><span className="gc-eyebrow">لوحة {role==="speaker"?"الشيخ":role==="relay"?"الجهاز الوسيط":"المستمع"}</span><h2>{role==="speaker"?"إدارة الصوت المباشر":role==="relay"?"استقبال وإعادة إرسال":"الاستماع للدعاء"}</h2></div><span className={"gc-status "+(links.some(p=>p.state==="connected")?"ok":"")}>{links.some(p=>p.state==="connected")?"متصل":"قيد التجهيز"}</span></div>
      {session&&<div className="gc-session">رقم الجلسة: <b dir="ltr">{session}</b></div>}
      <p className="gc-message">{notice}</p>
      {role==="speaker"&&!speakerStream.current&&<button className="gc-main" onClick={()=>void startBroadcast()}>🎙 بدء البث وفتح الميكروفون</button>}
      {role==="speaker"&&speakerStream.current&&<button className="gc-soft" onClick={toggleMute}>{muted?"تشغيل الميكروفون":"كتم الميكروفون مؤقتاً"}</button>}
      {role!=="speaker"&&<><audio ref={audio} controls playsInline autoPlay={false} className="gc-audio" /><button className="gc-main" disabled={!audioReady} onClick={()=>void play()}>{isPlaying?"🔊 الصوت يعمل — إعادة التشغيل":"🔊 تشغيل صوت الشيخ"}</button></>}
      {role==="relay"&&<p className="gc-note">أولاً امسح دعوة مصدر الصوت وردّ عليها. بعد الاتصال ووصول الصوت، بإمكانك إضافة مستمعين من جهازك.</p>}
      {role!=="listener"&&<button className="gc-outline" disabled={!available||!!waiting.current} onClick={()=>void addChild()}>＋ إضافة {role==="speaker"?"مستمع أو جهاز وسيط":"مستمع"} جديد</button>}
      <div className="gc-stats"><div><strong>{connected}</strong><small>مستمعون متصلون مباشرة</small></div><div><strong>{down.length}</strong><small>روابط صادرة</small></div><div><strong>{role==="speaker"?speakerStream.current?"مفتوح":"مغلق":audioReady?"متاح":"بانتظار"}</strong><small>مصدر الصوت</small></div></div>
      {quality&&<p className="gc-note">{quality}</p>}
      {outbound.length>0&&<section className="gc-qr"><h3>{role==="listener"||(!waiting.current&&role==="relay")?"اعرض الرد على الجهاز المصدر":"اعرض الدعوة للجهاز الآخر"}</h3><p>كل رمز QR جزء من معلومات الاتصال. انتقل للرمز التالي بعد مسحه من الهاتف الثاني.</p><div className="gc-qrcanvas"><QRCodeSVG value={outbound[page]} size={230} level="L" bgColor="#fff" fgColor="#11283c"/></div><div className="gc-pager"><button onClick={()=>setPage(i=>(i-1+outbound.length)%outbound.length)}>السابق</button><b>{page+1} / {outbound.length}</b><button onClick={()=>setPage(i=>(i+1)%outbound.length)}>التالي</button></div></section>}
      <div className="gc-divider"/>
      <h3>استقبال رمز الاتصال</h3><p className="gc-note">الجهاز الذي يستقبل الدعوة يمسح رموز QR، ثم يعرض رموز الرد ليتم مسحها من الجهاز المرسل.</p>
      <button className="gc-outline" onClick={()=>{setError("");if(scan)closeCamera();else setScan(true);}}>{scan?"إغلاق الكاميرا":"📷 مسح رمز QR بالكاميرا"}</button>
      {scan&&<video ref={video} autoPlay muted playsInline className="gc-video"/>}
      {inboundProgress&&<p className="gc-progress">{inboundProgress}</p>}
      <button className="gc-textlink" onClick={()=>setShowAdvanced(v=>!v)}>{showAdvanced?"إخفاء الربط اليدوي":"الربط اليدوي باستخدام النسخ واللصق"}</button>
      {showAdvanced&&<div className="gc-manual">{generated.current&&<><textarea readOnly value={"UM2FULL:"+generated.current} aria-label="رمز الجهاز"/><button className="gc-soft" onClick={()=>void navigator.clipboard.writeText("UM2FULL:"+generated.current)}>نسخ رمز الجهاز</button></>}<textarea value={manual} onChange={e=>setManual(e.target.value)} placeholder="ألصق رمز الجهاز الآخر" aria-label="رمز الطرف الآخر"/><button className="gc-outline" onClick={()=>void callback.current(manual)}>استقبال الرمز</button></div>}
      <div className="gc-divider"/><h3>الأجهزة المرتبطة</h3>
      {links.length===0?<p className="gc-note">لم يتم ربط أي جهاز بعد.</p>:<div className="gc-peerlist">{links.map(p=><div key={p.id} className="gc-peer"><span>{p.direction==="up"?"↑":"↓"} {p.label}</span><span className={p.state==="connected"?"gc-green":""}>{p.state==="connected"?"متصل":p.state==="failed"?"فشل":p.state==="disconnected"?"انقطع":"جاري الربط"}</span></div>)}</div>}
      <p className="gc-note">{network}</p>
      {error&&<div className="gc-error" role="alert">⚠ {error}</div>}
      <button className="gc-exit" onClick={()=>{stop();setRole(null);roleCurrent.current=null;setNotice("اختر دورك للبدء");}}>إنهاء الجلسة وقطع الاتصالات</button>
    </section>}
    <section className="gc-how"><h2>كيف تربط الموبايلات؟</h2><ol><li>ثبّت التطبيق على كل جهاز قبل انقطاع الإنترنت.</li><li>اتصلوا بشبكة Wi-Fi محلية واحدة، حتى لو ما فيها إنترنت. جرّب Hotspot موبايل لعدد صغير فقط.</li><li>الشيخ يبدأ البث ثم يضغط «إضافة مستمع» ويعرض QR.</li><li>المستمع يمسح كل الرموز، ثم الشيخ يمسح رموز الرد.</li><li>لربط جهاز وسيط، اختَر دوره أولاً؛ بعد استلام الصوت يقدر يضيف أجهزة أخرى بنفس الطريقة.</li><li>المستمع يضغط «تشغيل صوت الشيخ» ويترك الصفحة مفتوحة.</li></ol><div className="gc-footinfo">{swReady?"✓ ملفات التطبيق الأساسية تم تجهيزها للتشغيل بدون إنترنت":"تحقق من تثبيت التطبيق وتحميل ملفاته قبل الرحلة"}</div></section>
    <footer className="gc-footer">الصوت مباشر فقط · لا تسجيل ولا تخزين · الاتصال عبر WebRTC المحلي · النسخة لا تثبت دعم 100 جهاز ولا تعمل دون شبكة محلية</footer>
  </main>;
}