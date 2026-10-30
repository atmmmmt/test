"use client";

import { useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

type Role = "speaker" | "listener" | null;
type Signal = { type: "offer" | "answer"; sdp: string };
type PacketBox = { id: string; total: number; pieces: Record<number, string> };

type CameraControls = { stop: () => void };
const LIMIT = 450;

function b64url(data: Uint8Array) {
  let string = "";
  for (let i = 0; i < data.length; i += 8192) string += String.fromCharCode(...data.subarray(i, i + 8192));
  return btoa(string).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unbase64url(encoded: string) {
  const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const decoded = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(decoded, c => c.charCodeAt(0));
}
async function packSignal(signal: Signal) {
  const text = new TextEncoder().encode(JSON.stringify(signal));
  if (typeof CompressionStream !== "undefined") {
    const stream = new Blob([new Uint8Array(text)]).stream().pipeThrough(new CompressionStream("gzip"));
    return `G${b64url(new Uint8Array(await new Response(stream).arrayBuffer()))}`;
  }
  return `R${b64url(text)}`;
}
async function unpackSignal(encoded: string): Promise<Signal> {
  if (!encoded || !["G", "R"].includes(encoded[0])) throw Error("رمز الاتصال غير صحيح");
  const bytes = unbase64url(encoded.slice(1));
  const raw = encoded[0] === "G"
    ? await new Response(new Blob([new Uint8Array(bytes)]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer()
    : new Uint8Array(bytes).buffer;
  const parsed: unknown = JSON.parse(new TextDecoder().decode(raw));
  if (!parsed || typeof parsed !== "object" || !("type" in parsed) || !("sdp" in parsed)) {
    throw Error("بيانات الاتصال غير صالحة");
  }
  const obj = parsed as Record<string, unknown>;
  if ((obj.type !== "offer" && obj.type !== "answer") || typeof obj.sdp !== "string") {
    throw Error("نوع رمز الاتصال غير صالح");
  }
  return { type: obj.type, sdp: obj.sdp };
}
function packetsFor(encoded: string) {
  const id = Math.random().toString(36).slice(2, 9);
  const chunks = encoded.match(new RegExp(`.{1,${LIMIT}}`, "g")) || [];
  return chunks.map((piece, i) => `UC1|${id}|${i + 1}|${chunks.length}|${piece}`);
}
async function waitForCandidates(pc: RTCPeerConnection) {
  if (pc.iceGatheringState === "complete") return;
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => { cleanup(); reject(new Error("لم يكتمل اكتشاف الاتصال المحلي. حاول إعادة المحاولة.")); }, 16000);
    const onChange = () => { if (pc.iceGatheringState === "complete") { cleanup(); resolve(); } };
    function cleanup() { window.clearTimeout(timeout); pc.removeEventListener("icegatheringstatechange", onChange); }
    pc.addEventListener("icegatheringstatechange", onChange);
  });
}
function formatError(error: unknown) {
  if (error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "PermissionDeniedError")) {
    return "لازم تسمح للتطبيق باستخدام الميكروفون أو الكاميرا من إعدادات المتصفح.";
  }
  return error instanceof Error ? error.message : "حصل خطأ غير متوقع، حاول مرة ثانية.";
}

export default function LiveApp() {
  const [role, setRole] = useState<Role>(null);
  const [status, setStatus] = useState("جاهز للتجربة");
  const [connected, setConnected] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [qrPages, setQrPages] = useState<string[]>([]);
  const [qrIndex, setQrIndex] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [received, setReceived] = useState("لم تستقبل أي رموز بعد");
  const [manual, setManual] = useState("");
  const [error, setError] = useState("");
  const [showManual, setShowManual] = useState(false);
  const [audioAvailable, setAudioAvailable] = useState(false);
  const [installReady, setInstallReady] = useState(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const cameraControlsRef = useRef<CameraControls | null>(null);
  const incomingRef = useRef<PacketBox | null>(null);
  const processingRef = useRef(false);
  const onPacketRef = useRef<(value: string) => void>(() => {});
  const roleRef = useRef<Role>(null);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js")
        .then(async () => {
          await navigator.serviceWorker.ready;
          // Fetch and runtime-cache the QR scanner chunk while internet exists.
          await import("@zxing/browser");
          setInstallReady(true);
        }).catch(() => {});
    }
    return () => {
      cameraControlsRef.current?.stop();
      pcRef.current?.close();
      streamRef.current?.getTracks().forEach(track => track.stop());
    };
  }, []);

  function selectRole(value: Role) {
    closeAll();
    roleRef.current = value;
    setRole(value);
    setStatus("جاهز للاتصال");
  }
  function closeCamera() {
    cameraControlsRef.current?.stop();
    cameraControlsRef.current = null;
    setScanning(false);
  }
  function closeAll() {
    closeCamera();
    pcRef.current?.close();
    pcRef.current = null;
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    if (audioRef.current) audioRef.current.srcObject = null;
    incomingRef.current = null;
    processingRef.current = false;
    setConnected(false);
    setAudioAvailable(false);
    setMicOn(false);
    setQrPages([]);
    setQrIndex(0);
    setReceived("لم تستقبل أي رموز بعد");
    setError("");
  }
  function connectEvents(pc: RTCPeerConnection) {
    pc.addEventListener("connectionstatechange", () => {
      if (pc !== pcRef.current) return;
      const state = pc.connectionState;
      if (state === "connected") { setConnected(true); setStatus("الصوت متصل مباشرة عبر الشبكة المحلية"); }
      else if (state === "failed" || state === "disconnected" || state === "closed") {
        setConnected(false); setStatus(state === "failed" ? "فشل الاتصال — تحقق من شبكة Wi-Fi" : "انقطع الاتصال");
      } else { setStatus("جاري إنشاء الاتصال…"); }
    });
    pc.addEventListener("iceconnectionstatechange", () => {
      if (pc === pcRef.current && pc.iceConnectionState === "failed") {
        setError("لم يتمكن WebRTC من ربط الجهازين. تحقق من أن كلا الهاتفين على نفس Wi-Fi محلي وأن الشبكة تسمح بالاتصال بينهما.");
      }
    });
  }
  async function startSpeaker() {
    setError("");
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("المتصفح لا يسمح بفتح الميكروفون. افتح التطبيق من رابط HTTPS.");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      streamRef.current = stream;
      setMicOn(true);
      setStatus("الميكروفون مفتوح — لم يتصل مستمع بعد");
      await createOffer(stream);
    } catch (e) { setError(formatError(e)); setStatus("تعذّر بدء البث"); streamRef.current?.getTracks().forEach(t => t.stop()); setMicOn(false); }
  }
  async function createOffer(stream: MediaStream) {
    // This proof of concept supports ONE listener connection at a time.
    pcRef.current?.close();
    const pc = new RTCPeerConnection({ iceServers: [] });
    pcRef.current = pc;
    connectEvents(pc);
    stream.getAudioTracks().forEach(track => pc.addTrack(track, stream));
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitForCandidates(pc);
    if (!pc.localDescription) throw new Error("لم يتولد رمز الاتصال");
    setQrPages(packetsFor(await packSignal({ type: "offer", sdp: pc.localDescription.sdp })));
    setQrIndex(0);
    setStatus("اعرض رموز QR للمستمع واحداً بعد الآخر");
  }
  async function acceptSignal(signal: Signal) {
    if (roleRef.current === "listener") {
      if (signal.type !== "offer") throw new Error("تحتاج رمز الشيخ أولاً، وليس رمز المستمع");
      pcRef.current?.close();
      const pc = new RTCPeerConnection({ iceServers: [] });
      pcRef.current = pc;
      connectEvents(pc);
      pc.ontrack = (event: RTCTrackEvent) => {
        const stream = event.streams[0] || new MediaStream([event.track]);
        if (audioRef.current) audioRef.current.srcObject = stream;
        setAudioAvailable(true);
      };
      await pc.setRemoteDescription(signal);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await waitForCandidates(pc);
      if (!pc.localDescription) throw new Error("لم يتم إنشاء الرد");
      setQrPages(packetsFor(await packSignal({ type: "answer", sdp: pc.localDescription.sdp })));
      setQrIndex(0);
      setStatus("اعرض رموز الرد على الشيخ كي يكتمل الاتصال");
    } else if (roleRef.current === "speaker") {
      if (signal.type !== "answer") throw new Error("هذا رمز بدء بث وليس رمز رد المستمع");
      if (!pcRef.current || pcRef.current.signalingState !== "have-local-offer") throw new Error("ابدأ البث وأظهر رمز الشيخ أولاً");
      await pcRef.current.setRemoteDescription(signal);
      setStatus("وصل الرد — جاري توصيل الصوت المباشر…");
    } else { throw new Error("اختر دورك أولاً"); }
  }
  async function receiveToken(text: string) {
    if (processingRef.current) return;
    try {
      const cleaned = text.trim();
      if (cleaned.startsWith("UC1FULL:")) {
        processingRef.current = true;
        closeCamera();
        await acceptSignal(await unpackSignal(cleaned.slice("UC1FULL:".length)));
        setReceived("تم استقبال معلومات الاتصال كاملة");
        return;
      }
      const match = /^UC1\|([a-z0-9]+)\|(\d+)\|(\d+)\|([A-Za-z0-9_\-]+)$/.exec(cleaned);
      if (!match) throw new Error("رمز غير معروف؛ استخدم QR من التطبيق نفسه");
      const [, id, rawIndex, rawTotal, chunk] = match;
      const index = Number(rawIndex), total = Number(rawTotal);
      if (total < 1 || total > 100 || index < 1 || index > total) throw new Error("QR غير صالح");
      if (!incomingRef.current || incomingRef.current.id !== id) incomingRef.current = { id, total, pieces: {} };
      const box = incomingRef.current;
      if (box.total !== total) throw new Error("الرموز مختلفة، أعد المحاولة");
      box.pieces[index] = chunk;
      const count = Object.keys(box.pieces).length;
      setReceived(`تم استقبال ${count} من أصل ${total} رمز QR`);
      if (count === total) {
        processingRef.current = true;
        closeCamera();
        const encoded = Array.from({length: total}, (_, i) => box.pieces[i + 1]).join("");
        await acceptSignal(await unpackSignal(encoded));
        incomingRef.current = null;
        setReceived("وصلت الرموز كاملة ✓");
      }
    } catch (e) { setError(formatError(e)); processingRef.current = false; }
  }
  onPacketRef.current = receiveToken;

  useEffect(() => {
    if (!scanning) return;
    let cancelled = false;
    (async () => {
      try {
        const { BrowserQRCodeReader } = await import("@zxing/browser");
        const reader = new BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: 550 });
        if (!videoRef.current) throw new Error("لم يتم تجهيز الكاميرا");
        const controls = await reader.decodeFromConstraints(
          { audio: false, video: { facingMode: { ideal: "environment" } } },
          videoRef.current,
          (result) => { if (result) void onPacketRef.current(result.getText()); }
        );
        if (cancelled) controls.stop();
        else cameraControlsRef.current = controls;
      } catch (e) { if (!cancelled) { setScanning(false); setError(formatError(e)); } }
    })();
    return () => { cancelled = true; cameraControlsRef.current?.stop(); cameraControlsRef.current = null; };
  }, [scanning]);
  async function startListening() {
    setError("");
    try {
      if (!audioRef.current) return;
      await audioRef.current.play();
      setStatus("تشغيل الصوت المباشر");
    } catch (e) { setError("اضغط تشغيل الصوت مجدداً وتأكد أن الهاتف ليس على الوضع الصامت. " + formatError(e)); }
  }
  const combinedToken = qrPages.length ? `UC1FULL:${qrPages.map(p => p.split("|").slice(4).join("|")).join("")}` : "";
  const isSpeaker = role === "speaker";
  const isListener = role === "listener";

  return <main className="shell">
    <header className="topline">
      <div className="brandmark">☪</div>
      <div className="brandtext"><strong>رفقة العمرة</strong><span>UMRAH LIVE · بث الدعاء</span></div>
      <span className="pill">● تجربة محلية</span>
    </header>
    <section className="hero">
      <h1>صوت الشيخ، <span>مباشرةً إليك.</span></h1>
      <p>نسخة تجريبية للبث الصوتي المباشر فقط، بدون تسجيل أو حفظ صوت. صُممت لاختبار الاتصال بين هاتفين على نفس شبكة Wi-Fi المحلية، حتى لو ما فيها إنترنت.</p>
    </section>
    <div className="warning"><strong>قبل البدء:</strong> لازم يكون الهاتفان على نفس شبكة Wi-Fi أو Hotspot محلي، ويتثبت التطبيق وتتحمّل كل ملفاته قبل انقطاع الإنترنت. بدون شبكة مشتركة ما رح ينتقل الصوت. هذه نسخة اختبار بين جهازين وليست شبكة لـ100 شخص.</div>
    <div className="cards">
      <button type="button" className={`option ${isSpeaker ? "selected" : ""}`} onClick={() => selectRole("speaker")}><span className="ico">🎙️</span><strong>أنا الشيخ</strong><small>أفتح الميكروفون وأرسل الصوت المباشر</small></button>
      <button type="button" className={`option ${isListener ? "selected" : ""}`} onClick={() => selectRole("listener")}><span className="ico">🎧</span><strong>أنا مستمع</strong><small>أستقبل الصوت مباشرة بدون تسجيل</small></button>
    </div>
    {role && <section className="card">
      <div className="row"><h2>{isSpeaker ? "لوحة البث المباشر" : "لوحة الاستماع"}</h2><span className={`status ${connected ? "good" : error ? "bad" : "pending"}`}>{connected ? "متصل" : micOn ? "البث بانتظار المستمع" : "غير متصل"}</span></div>
      <p>{status}</p>
      {isSpeaker && <>
        {micOn && <div className="meter" aria-label="الميكروفون مفتوح، هذه حركة شكلية وليست قياسا لمستوى الصوت">{Array.from({length: 15}, (_,i)=><i key={i}/>)}</div>}
        {!micOn ? <button className="primary" onClick={() => void startSpeaker()}>🎙️ فتح الميكروفون وإنشاء دعوة الاتصال</button> : <button className="secondary destruct" onClick={() => {closeAll();setStatus("تم إنهاء البث");}}>إنهاء البث</button>}
        <p className="audioonly">لأسباب تقنية، الميكروفون المفتوح ما بيعني وصول الصوت. لازم يكتمل تبادل رموز QR ويتحول المؤشر إلى «متصل».</p>
      </>}
      {isListener && <>
        <audio ref={audioRef} className="audio" controls playsInline autoPlay={false} />
        {audioAvailable && <button className="primary" onClick={() => void startListening()}>🔊 تشغيل الصوت المباشر</button>}
        <p className="audioonly">اسمع باستخدام سماعة شخصية، وخلي شاشة التطبيق مفتوحة أثناء التجربة، خصوصاً على آيفون.</p>
      </>}
      {qrPages.length > 0 && <div className="qrbox">
        <p style={{textAlign:"center",margin:"4px 0"}}>{isSpeaker ? "خلّي المستمع يصوّر الرموز التالية بالترتيب" : "خلّي الشيخ يصوّر رموز الرد التالية"}</p>
        <div className="qrcode"><QRCodeSVG value={qrPages[qrIndex]} size={260} level="L" bgColor="#ffffff" fgColor="#10202b" marginSize={0}/></div>
        <div className="qrnav"><button onClick={()=>setQrIndex(i=>(i-1+qrPages.length)%qrPages.length)}>السابق</button><b>{qrIndex+1} / {qrPages.length}</b><button onClick={()=>setQrIndex(i=>(i+1)%qrPages.length)}>التالي</button></div>
      </div>}
      <hr />
      <h2>تبادل رمز الطرف الثاني</h2>
      <p>{isSpeaker ? "بعد ما المستمع يجهّز رمز الرد، امسحه بكاميرا موبايل الشيخ." : "امسح رموز الشيخ كلها بالترتيب حتى يظهر عندك رمز الرد."}</p>
      <div className="actions">
        {!scanning ? <button className="secondary" onClick={() => { setError(""); setScanning(true); }}>📷 فتح الكاميرا لمسح QR</button> : <button className="secondary destruct" onClick={closeCamera}>إغلاق الكاميرا</button>}
      </div>
      {scanning && <video ref={videoRef} autoPlay muted playsInline />}
      <div className="progress">{received}</div>
      <button className="secondary" style={{marginTop:15}} onClick={()=>setShowManual(s=>!s)}>{showManual ? "إخفاء الطريقة اليدوية" : "إظهار الرموز كنص (للتشخيص)"}</button>
      {showManual && <>
        <p>النسخ واللصق للتجربة التقنية فقط. بين هاتفين دون إنترنت استخدم الكاميرا ورموز QR.</p>
        {combinedToken && <><textarea readOnly value={combinedToken} aria-label="رمز جهازي كنص" /><button className="secondary" onClick={() => void navigator.clipboard.writeText(combinedToken)}>نسخ رمز جهازي</button></>}
        <textarea value={manual} onChange={e=>setManual(e.target.value)} placeholder="ألصق رمز الطرف الآخر هنا" aria-label="رمز الطرف الآخر" />
        <button className="primary" onClick={()=>void onPacketRef.current(manual)}>استقبال الرمز الملصوق</button>
      </>}
      {error && <div role="alert" className="error">⚠️ {error}</div>}
    </section>}
    <section className="card">
      <h2>طريقة التجربة بين هاتفين</h2>
      <ol className="steps">
        <li>ثبّت التطبيق وافتحه مرة كاملة على الجهازين بوجود الإنترنت أولاً.</li>
        <li>اقطع بيانات الإنترنت، واتصل من الهاتفين على Wi-Fi أو Hotspot محلي واحد.</li>
        <li>الشيخ يختار «أنا الشيخ» ويفتح الميكروفون.</li>
        <li>المستمع يمسح كل رموز QR المعروضة على هاتف الشيخ.</li>
        <li>المستمع يعرض رموز الرد؛ الشيخ يمسحها.</li>
        <li>لما يصير الاتصال «متصل»، المستمع يضغط «تشغيل الصوت».</li>
      </ol>
      <div className="info"><span>ملفات التطبيق المحفوظة للاستخدام دون إنترنت</span><b>{installReady ? "Service Worker مسجّل" : "تحتاج تثبيت / تحميل أولي"}</b></div>
    </section>
    <p className="foot">نسخة إثبات فكرة · بث مباشر فقط · لا يوجد MediaRecorder أو قاعدة بيانات أو سيرفر لتخزين الصوت · ليس حلّاً مثبتاً لـ100 مستمع</p>
  </main>;
}
