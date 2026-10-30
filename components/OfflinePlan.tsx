"use client";
import { useEffect, useMemo, useState } from "react";

const GROUPS = [15, 15, 14, 14, 14, 14, 14].map((size, index, sizes) => {
  const first = sizes.slice(0, index).reduce((a, b) => a + b, 0) + 1;
  return { id: index + 1, size, first, last: first + size - 1, code: `UMRAH-${String(index + 1).padStart(2, "0")}` };
});
const IOS = "https://apps.apple.com/us/app/murmur-bluetooth-group-calls/id1468540385";
const ANDROID = "https://play.google.com/store/apps/details?id=uk.co.hippocamp.murmur";
const DONE = ["install", "bluetooth", "permissions", "join", "listen"] as const;
type DoneKey = (typeof DONE)[number];
function CopyButton({ value, title = "نسخ" }: { value: string; title?: string }) {
  const [copied, setCopied] = useState(false);
  return <button className="uc-mini-button" type="button" onClick={async () => {
    try { await navigator.clipboard.writeText(value); setCopied(true); window.setTimeout(() => setCopied(false), 1700); }
    catch { window.prompt("انسخ النص التالي:", value); }
  }}>{copied ? "تم النسخ ✓" : title}</button>;
}
function DownloadLinks() {
  return <div className="uc-stores"><a href={IOS} target="_blank" rel="noopener noreferrer"><span></span> App Store</a><a href={ANDROID} target="_blank" rel="noopener noreferrer"><span>▶</span> Google Play</a></div>;
}
export default function OfflinePlan() {
  const [number, setNumber] = useState("");
  const [name, setName] = useState("");
  const [tab, setTab] = useState<"member" | "captain" | "test">("member");
  const [checks, setChecks] = useState<DoneKey[]>([]);
  const [tested, setTested] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState(1);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(()=>{});
    try {
      const saved = JSON.parse(localStorage.getItem("umrah-offline-v1") || "{}");
      setNumber(String(saved.number ?? "")); setName(String(saved.name ?? ""));
      setChecks(Array.isArray(saved.checks) ? saved.checks.filter((x: unknown) => DONE.includes(x as DoneKey)) : []);
      setTested(typeof saved.tested === "object" && saved.tested ? saved.tested : {});
      setSelected(Math.max(1, Math.min(7, Number(saved.selected) || 1)));
    } catch { /* no stored profile */ }
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem("umrah-offline-v1", JSON.stringify({number, name, checks, tested, selected})); } catch { /* storage unavailable */ }
  }, [number, name, checks, tested, selected, ready]);
  const n = Number(number);
  const valid = Number.isInteger(n) && n >= 1 && n <= 100;
  const group = useMemo(() => valid ? GROUPS.find(g => n >= g.first && n <= g.last) : undefined, [n, valid]);
  const countReady = checks.length;
  const allPassed = ["two", "four", "sixteen", "twoGroups", "hundred"].every(k => tested[k]);
  const steps: { key: DoneKey; label: string; desc: string }[] = [
    { key: "install", label: "نزّلت Murmur على الموبايل", desc: "التنزيل لازم يتم قبل السفر وأثناء وجود الإنترنت." },
    { key: "bluetooth", label: "البلوتوث شغّال", desc: "وقت الاختبار طفّئ البيانات والواي فاي بالكامل." },
    { key: "permissions", label: "سمحت بصلاحيات التطبيق", desc: "البلوتوث والميكروفون والصلاحيات المطلوبة بالجهاز." },
    { key: "join", label: "دخلت المجموعة الصحيحة", desc: "افتح Murmur وأنشئ/انضم للمجموعة بالاسم المكتوب هنا. الربط ما بيتم من الموقع." },
    { key: "listen", label: "سمعت الصوت مباشر بالاختبار", desc: "لا تعتبر نفسك جاهزاً قبل تجربة الاستماع فعلياً." }
  ];
  const scenarios = [
    { k: "two", name: "صوت مباشر على آيفون وأندرويد", devices: "2 أجهزة" },
    { k: "four", name: "تمرير الصوت عبر جهاز ثالث", devices: "3–4 أجهزة" },
    { k: "sixteen", name: "مجموعة واحدة مكتملة لمدة 20 دقيقة", devices: "14–16 جهازاً" },
    { k: "twoGroups", name: "مجموعتان جنب بعض بدون تداخل", devices: "28–30 جهازاً" },
    { k: "hundred", name: "تجربة جميع المجموعات في مكان مشابه", devices: "100 جهاز" }
  ];
  const notes = [
    "نستخدم Murmur للبث الصوتي، وليس هذا الموقع. Murmur تطبيق مستقل ويحتاج تثبيت مسبق على كل موبايل.",
    "كل مجموعة لها بث مستقل من منظم قريب من الشيخ. ما في بث واحد مضمون يوصل إلى المئة عبر المجموعات السبع.",
    "أسماء المجموعات بالصفحة مقترحة للتنظيم؛ لازم إنشاؤها يدوياً داخل Murmur، ولا توجد مزامنة مباشرة معه.",
    "عدد المتصلين وحالات النجاح على هذه الصفحة محفوظة على جهازك فقط، وليست قياسات حقيقية من تطبيق Murmur.",
    "تطبيق Murmur يعلن حد 16 شخصاً للمجموعة. نجاح 7 مجموعات بالمكان نفسه غير مؤكد ولازم تجربة ميدانية كاملة.",
    "نسخة Murmur المجانية قد تحتوي مقاطع صوتية فكاهية. اختبر تعطيلها قبل الدعاء."
  ];
  return <main className="uc" dir="rtl">
    <header className="uc-header"><div className="uc-mark"><span>☪</span><div><strong>رفقة العمرة</strong><small>UMRAH CONNECT</small></div></div><span className="uc-chip">خطة اتصال بلا إنترنت</span></header>
    <section className="uc-hero"><div className="uc-kicker"><i/> برنامج تنسيق الرحلة</div><h1>صوت الشيخ،<br/><em>ورفقة ما بتنقطع.</em></h1><p>جهزنا خطة للمجموعة المؤلفة من 100 شخص بالاعتماد على مكالمات بلوتوث Mesh في تطبيق Murmur. هالصفحة للتنظيم والتحضير، والصوت بينتقل عبر Murmur نفسه.</p><div className="uc-hero-actions"><a href="#my-group" className="uc-primary">اعرف مجموعتك <span>←</span></a><a href="#downloads" className="uc-secondary">تحميل تطبيق الصوت</a></div></section>
    <section className="uc-metrics" aria-label="ملخص الخطة"><div><b>100</b><span>مشارك مخطّط</span></div><div><b>07</b><span>مجموعات منفصلة</span></div><div><b>16</b><span>الحد المعلن للمجموعة</span></div><div><b>0</b><span>إنترنت أثناء البث</span></div></section>
    <section className="uc-caution"><strong>مهم قبل الاعتماد على الخطة</strong><p>البث لـ100 شخص لم يُختبر بعد. الخطة تعتمد على 7 منظّمين يلتقط كل واحد منهم صوت الشيخ بموبايله داخل مجموعة مستقلة. ما في اتصال أو مشاركة أسماء بين هذه الصفحة وتطبيق Murmur.</p></section>
    <section className="uc-surface" id="my-group"><div className="uc-section-top"><div><span className="uc-overline">01 / تنظيم الأشخاص</span><h2>شو هي مجموعتك؟</h2><p>كل مشارك بياخد رقماً من 1 إلى 100 من منظم الرحلة.</p></div><span className="uc-section-icon">✦</span></div>
      <div className="uc-switch" role="tablist" aria-label="نوع العرض"><button role="tab" aria-selected={tab === "member"} className={tab === "member" ? "active" : ""} onClick={() => setTab("member")}>أنا مشارك</button><button role="tab" aria-selected={tab === "captain"} className={tab === "captain" ? "active" : ""} onClick={() => setTab("captain")}>أنا منظم</button><button role="tab" aria-selected={tab === "test"} className={tab === "test" ? "active" : ""} onClick={() => setTab("test")}>الاختبار</button></div>
      {tab === "member" && <div className="uc-member">
        <div className="uc-fields"><label>اسمك (اختياري)<input value={name} maxLength={36} placeholder="مثلاً أحمد" onChange={e => setName(e.target.value)} /></label><label>رقمك بالمجموعة (1–100)<input value={number} type="number" min="1" max="100" inputMode="numeric" placeholder="مثلاً 23" onChange={e => setNumber(e.target.value)} /></label></div>
        {group ? <div className="uc-result"><div className="uc-result-head"><div><span>تم تحديد المجموعة</span><h3>المجموعة {String(group.id).padStart(2,"0")}</h3></div><span className="uc-result-count">{group.size} شخص</span></div><div className="uc-code"><div><small>اسم المجموعة داخل Murmur</small><b dir="ltr">{group.code}</b></div><CopyButton value={group.code}/></div><p>الأرقام من <b>{group.first}</b> إلى <b>{group.last}</b> · رقم المنظم <b>{group.first}</b>{n===group.first ? " · أنت منظم هذه المجموعة" : ""}</p></div> : <div className="uc-result-empty">أدخل رقمك حتى نحدد المجموعة واسمها تلقائياً.</div>}
        <div className="uc-checklist"><div className="uc-check-heading"><strong>تجهيز موبايلك</strong><span>{countReady}/5 جاهز</span></div><div className="uc-track"><span style={{width:`${countReady*20}%`}} /></div>{steps.map(s=><label key={s.key} className="uc-check"><input type="checkbox" checked={checks.includes(s.key)} onChange={e=>setChecks(old=>e.target.checked?[...old,s.key]:old.filter(x=>x!==s.key))}/><span><strong>{s.label}</strong><small>{s.desc}</small></span></label>)}</div>
      </div>}
      {tab === "captain" && <div className="uc-captain"><p className="uc-tab-note">المنظمون السبعة يقفون قريباً من الشيخ، وكل واحد منهم يفتح مجموعة صوت مستقلة داخل Murmur. أرقامهم أول رقم بكل مجموعة.</p><div className="uc-group-grid">{GROUPS.map(g=><button key={g.id} className={`uc-group-card ${selected===g.id?"chosen":""}`} onClick={()=>setSelected(g.id)}><div><strong>{String(g.id).padStart(2,"0")}</strong><span>{g.size} شخص</span></div><b dir="ltr">{g.code}</b><small>الأرقام {g.first}–{g.last}</small></button>)}</div><div className="uc-captain-detail"><div><span>المجموعة المحددة</span><strong>{GROUPS[selected-1].code}</strong><small>منظمها صاحب الرقم {GROUPS[selected-1].first} · الأعضاء {GROUPS[selected-1].first}–{GROUPS[selected-1].last}</small></div><CopyButton value={`مجموعة العمرة ${selected}\nاسم Murmur: ${GROUPS[selected-1].code}\nالأرقام: ${GROUPS[selected-1].first}–${GROUPS[selected-1].last}\nنزّل Murmur قبل السفر، شغّل البلوتوث، وانضم للمجموعة يدوياً. لازم يكون عندك اختبار صوت ناجح قبل الرحلة.`} title="نسخ تعليمات المجموعة"/></div><button className="uc-print" onClick={()=>window.print()}>طباعة توزيع المجموعات</button></div>}
      {tab === "test" && <div className="uc-tests"><p className="uc-tab-note">علّم النتائج بعد اختبار الأجهزة فعلياً فقط. الخانات تبقى محفوظة على هذا الجهاز ولا تُزامَن.</p>{scenarios.map(t=><label className="uc-test" key={t.k}><input type="checkbox" checked={!!tested[t.k]} onChange={e=>setTested(s=>({...s,[t.k]:e.target.checked}))}/><span><strong>{t.name}</strong><small>{t.devices}</small></span><b>{tested[t.k]?"اجتاز":"لم يُختبر"}</b></label>)}<div className={`uc-test-status ${allPassed?"passed":""}`}>{allPassed?"✓ جميع مراحل الاختبار معلّمة كناجحة على هذا الجهاز. تأكّد من توثيق النتائج ميدانياً.":"ما تعتبر الحل جاهزاً للعمرة قبل اجتياز اختبار 100 جهاز عملياً."}</div></div>}
    </section>
    <section className="uc-surface" id="downloads"><div className="uc-section-top"><div><span className="uc-overline">02 / التطبيق المسؤول عن الصوت</span><h2>نزّل Murmur قبل السفر</h2><p>مجاني للتثبيت مع مشتريات داخل التطبيق، ويدعم آيفون وأندرويد وبلوتوث Mesh.</p></div><span className="uc-section-icon">◈</span></div><DownloadLinks/><div className="uc-guide"><div><b>١</b><p>المنظم ينشئ داخل Murmur مجموعة باسم <code>UMRAH-01</code> وهكذا حتى السابعة.</p></div><div><b>٢</b><p>كل مشارك يفتح Murmur وينضم لمجموعته. لازم تكون صلاحيات البلوتوث والميكروفون متاحة.</p></div><div><b>٣</b><p>المنظم يقف قرب الشيخ حتى يلتقط الميكروفون صوته، ويجري اختباراً بمستمعين.</p></div><div><b>٤</b><p>اعملوا تجربة جماعية كاملة بلا Wi-Fi ولا بيانات، مع سماعات وسماع واضح، قبل موعد الرحلة.</p></div></div></section>
    <section className="uc-surface"><div className="uc-section-top"><div><span className="uc-overline">03 / حدود التقنية</span><h2>شو لازم ننتبه له؟</h2></div></div><ul className="uc-notes">{notes.map((s,i)=><li key={i}>{s}</li>)}</ul><a className="uc-lab" href="/lab">فتح مختبر WebRTC القديم (بحاجة Wi-Fi محلي) ←</a></section>
    <footer className="uc-footer"><div>☪ <strong>رفقة العمرة</strong></div><p>مرافق لتنظيم مجموعات البث. ليس تطبيق إرسال صوت، ولا يتحكم في Murmur. البث المباشر يعمل فقط عند نجاح الاتصال في التطبيق الخارجي.</p></footer>
  </main>;
}