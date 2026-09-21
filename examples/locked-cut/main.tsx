import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Play, Pause, Lock, Unlock, ArrowRight, Upload, RotateCcw, Download, X, Settings2 } from "lucide-react";
import { applyProposal, diffusionSource, fixtureShots, initialCut, validateShots, type Cut, type Shot } from "./sequence";
import "./style.css";
const briefs = { quiet: "Quiet anticipation. Begin in stillness, build through small gestures, reveal the object late, and end with release.", fast: "Fast reveal. Lead with the object and impact, then movement, scale, and a decisive bright ending." };
function download(name: string, content: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([content], { type })); const a = document.createElement("a"); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function App() {
  const [shots, setShots] = useState<Shot[]>(fixtureShots); const [cuts, setCuts] = useState<Cut[]>(initialCut(fixtureShots));
  const [locks, setLocks] = useState<number[]>([]); const [brief, setBrief] = useState(briefs.quiet);
  const [urls, setUrls] = useState<Record<string, string>>({}); const [fixtures, setFixtures] = useState(true);
  const [mode, setMode] = useState<"fixture" | "jev">("fixture"); const [key, setKey] = useState("");
  const [status, setStatus] = useState("Test slates loaded. Lock a shot, then change the brief.");
  const [busy, setBusy] = useState(false); const [details, setDetails] = useState(false);
  const [playing, setPlaying] = useState(false); const [time, setTime] = useState(0);
  const [evidence, setEvidence] = useState<unknown>(null); const [before, setBefore] = useState<Cut[] | null>(null);
  const [editShot, setEditShot] = useState<string | null>(null); const [importing, setImporting] = useState(false);
  const video = useRef<HTMLVideoElement>(null); const files = useRef<HTMLInputElement>(null);
  const slot = Math.min(5, Math.floor(time / 2)), active = shots.find(s => s.id === cuts[slot]?.shotId)!;
  const previousUrls = useRef(urls); const request = useRef(0);
  useEffect(() => { previousUrls.current = urls; }, [urls]);
  useEffect(() => () => { Object.values(previousUrls.current).forEach(URL.revokeObjectURL); request.current++; }, []);
  useEffect(() => {
    if (!playing) return;
    const started = performance.now() - time * 1000; let frame = 0;
    const tick = () => { const t = (performance.now() - started) / 1000; setTime(Math.min(12, t)); if (t >= 12) setPlaying(false); else frame = requestAnimationFrame(tick); };
    frame = requestAnimationFrame(tick); return () => cancelAnimationFrame(frame);
  }, [playing]);
  useEffect(() => {
    const element = video.current; if (!element) return;
    const sync = () => { element.currentTime = Math.max(0, time - slot * 2); if (playing) void element.play().catch(() => { setPlaying(false); setStatus("Playback was blocked. Press Play to resume."); }); else element.pause(); };
    if (element.readyState >= 1) sync(); else element.addEventListener("loadedmetadata", sync, { once: true });
    return () => element.removeEventListener("loadedmetadata", sync);
  }, [slot, playing, cuts, urls]);
  function seek(t: number) { setPlaying(false); setTime(t); if (video.current && Math.floor(t / 2) === slot) video.current.currentTime = Math.max(0, t - slot * 2); }
  async function recut() {
    setPlaying(false); setBusy(true); const id = ++request.current;
    const snapshot = { shots, current: cuts, locks, brief };
    try {
      if (!fixtures && shots.some(s => !s.tags.trim() || s.tags === "Add descriptive tags")) throw new Error("Describe every imported clip in Studio setup before asking Jev.");
      let next: Cut[], info: unknown, message: string;
      if (mode === "fixture") {
        if (!fixtures) throw new Error("Fixture mode is only for authored test slates. Choose Jev for your clips.");
        if (brief !== briefs.quiet && brief !== briefs.fast) throw new Error("Fixture mode only demonstrates the two preset briefs. Choose Jev to judge your own brief.");
        const desired = brief === briefs.fast ? ["06", "07", "04", "08", "02", "10"] : ["01", "03", "02", "05", "06", "10"];
        const reserved = new Set(locks.map(i => cuts[i]!.shotId));
        const free = [...desired, ...shots.map(s => s.id)].filter((v, i, a) => a.indexOf(v) === i && !reserved.has(v)); let cursor = 0;
        next = applyProposal(shots, cuts, locks, { id: "fixture", cuts: cuts.map((c, i) => locks.includes(i) ? c : { shotId: free[cursor++]!, sourceIn: 0, duration: 2 }) });
        info = { source: "authored-fixture", modelCalled: false, brief, lockedSlots: locks.map(i => i + 1) }; message = "Authored fixture cut. No model was called.";
      } else {
        setStatus("Jev is comparing eligible cuts from your tags. Locked shots stay fixed.");
        const response = await fetch("/api/story", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...snapshot, apiKey: key }) });
        const result = await response.json(); if (!response.ok) throw new Error(result.error);
        if (id !== request.current) return;
        info = result; message = result.reason;
        if (result.status !== "selected") { setEvidence({ request: snapshot, result: info }); setStatus(message); return; }
        next = applyProposal(shots, cuts, locks, { id: "returned", cuts: result.cuts });
      }
      if (id !== request.current) return;
      setBefore(cuts); setCuts(next); setTime(0); setEvidence({ request: snapshot, result: info }); setStatus(message);
    } catch (error) { const message = error instanceof Error ? error.message : "Could not make a cut. The current cut is unchanged."; setEvidence({ request: snapshot, result: { status: "failed", source: mode, reason: message } }); setStatus(message); }
    finally { if (id === request.current) setBusy(false); }
  }
  async function importClips(selected: FileList | null) {
    if (!selected) return; const input = Array.from(selected); setImporting(true); const newUrls: Record<string, string> = {};
    try {
      if (input.length < 8 || input.length > 12) throw new Error("Choose 8–12 owned video clips together.");
      if (new Set(input.map(f => f.name)).size !== input.length) throw new Error("Use distinct clip filenames for export.");
      const imported: Shot[] = [];
      for (let i = 0; i < input.length; i++) {
        const file = input[i]!; if (!file.type.startsWith("video/")) throw new Error("Choose video files only.");
        const id = `clip-${i + 1}`; const url = URL.createObjectURL(file); newUrls[id] = url;
        const duration = await new Promise<number>((resolve, reject) => {
          const element = document.createElement("video"); element.preload = "metadata";
          const done = () => { clearTimeout(timer); element.removeAttribute("src"); element.load(); };
          const timer = setTimeout(() => { done(); reject(new Error("A clip could not be read within ten seconds.")); }, 10000);
          element.onloadedmetadata = () => { const d = element.duration; done(); resolve(d); }; element.onerror = () => { done(); reject(new Error("A video format could not be read.")); }; element.src = url;
        });
        imported.push({ id, name: file.name.replace(/\.[^.]+$/, ""), tags: "Add descriptive tags", transcript: "", duration, fileName: file.name });
      }
      validateShots(imported); Object.values(urls).forEach(URL.revokeObjectURL);
      setUrls(newUrls); setShots(imported); setCuts(initialCut(imported)); setLocks([]); setBefore(null); setFixtures(false); setMode("jev"); setEvidence(null); setTime(0); setPlaying(false); setDetails(true);
      setStatus("Clips stay on this device. Add honest tags before asking Jev; only tags, titles, and transcripts are sent.");
    } catch (error) { Object.values(newUrls).forEach(URL.revokeObjectURL); setStatus((error as Error).message); }
    finally { setImporting(false); if (files.current) files.current.value = ""; }
  }
  const disabled = busy || importing;
  return <main>
    <header><a className="brand" href="#">otto<span>*</span></a><span className="divider"/><span>Locked Cut</span><span className="header-note">A study in editorial choice</span><button className="quiet" onClick={() => setDetails(!details)} aria-expanded={details}><Settings2 size={16}/> Studio setup</button></header>
    <section className="intro"><div><h1>Same footage.<br/><em>A different feeling.</em></h1></div><p>Keep the shot that matters.<br/>Let the rest find a new rhythm.</p></section>
    <section className="workspace" aria-label="Sequence workspace">
      <div className="stage" data-fixture={fixtures}>
        {fixtures ? <div className={`slate slate-${Number(active.id) % 4}`}><span className="slate-meta">AUTHORED TEST SLATE / NO FOOTAGE</span><strong>{active.id}</strong><span className="slate-title">{active.name}</span><div className="slate-rule"/></div> : <video ref={video} src={urls[active.id]} muted playsInline onError={() => { setPlaying(false); setStatus("This clip could not play. Check the source format."); }}/>} 
        <span className="stage-label">{fixtures ? "Test slate library" : "Local footage"} <span>·</span> {slot + 1} / 6</span>
        {locks.includes(slot) && <span className="stage-lock"><Lock size={13}/> Locked</span>}
      </div>
      <div className="transport"><button className="play" aria-label={playing ? "Pause sequence" : "Play sequence"} disabled={disabled} onClick={() => { if (time >= 12) setTime(0); setPlaying(!playing); }}>{playing ? <Pause size={18}/> : <Play size={18}/>}</button><span className="time">{time.toFixed(1).padStart(4, "0")} <span>/ 12.0</span></span><input aria-label="Sequence playhead" type="range" min="0" max="11.999" step="0.01" value={time} onChange={e => seek(Number(e.target.value))}/><span className="duration">6 shots · 2 seconds each</span></div>
      <div className="strip">{cuts.map((cut, i) => { const shot = shots.find(s => s.id === cut.shotId)!; const locked = locks.includes(i), changed = before && before[i]?.shotId !== cut.shotId; return <div key={i} className={`shot ${i === slot ? "active" : ""} ${locked ? "locked" : ""}`}>
        <button className="shot-seek" onClick={() => seek(i * 2)} aria-label={`Preview shot ${i + 1}: ${shot.name}`}><span className="shot-top"><span>{String(i + 1).padStart(2, "0")}</span>{changed && <span className="changed">Changed</span>}</span>{fixtures ? <strong>{shot.id}</strong> : <video src={urls[shot.id]} muted preload="metadata"/>}<span className="shot-name">{shot.name}</span></button>
        <button className="lock-button" disabled={disabled} aria-label={`${locked ? "Unlock" : "Lock"} shot ${i + 1}`} aria-pressed={locked} onClick={() => setLocks(locked ? locks.filter(n => n !== i) : [...locks, i])}>{locked ? <Lock size={14}/> : <Unlock size={14}/>}<span>{locked ? "Locked" : "Lock shot"}</span></button>
      </div>; })}</div>
      <div className="brief-area"><div className="brief-label"><label htmlFor="brief">The direction</label><div className="presets">{Object.entries(briefs).map(([id, text]) => <button key={id} disabled={disabled} aria-pressed={brief === text} onClick={() => setBrief(text)}>{id === "quiet" ? "Quiet anticipation" : "Fast reveal"}</button>)}</div></div><div className="composer"><textarea id="brief" value={brief} maxLength={800} disabled={disabled} onChange={e => setBrief(e.target.value)}/><button className="primary" disabled={disabled || locks.length === 6 || !brief.trim()} onClick={recut}>{busy ? "Choosing…" : "Make another cut"}<ArrowRight size={18}/></button></div><div className="under-composer"><span role="status" aria-live="polite">{status}</span><span>{locks.length} locked · 12s held</span></div></div>
      <footer><span>{mode === "fixture" ? "Fixture mode · no AI decisions" : "TypeSafe Jev · metadata only"}</span><div><button className="quiet" disabled={!before || disabled} onClick={() => { if (before) { setCuts(before); setBefore(null); setTime(0); setPlaying(false); setLocks([]); setEvidence(null); setStatus("Previous cut restored. Locks cleared; choose your anchor again."); } }}><RotateCcw size={14}/> Previous cut</button><button className="quiet" disabled={disabled} onClick={() => { download("index.tsx", diffusionSource(shots, cuts, fixtures)); setStatus(fixtures ? "Test-slate composition exported. Open its folder in Diffusion Studio." : "Composition exported. Put original clips in the project’s assets folder before opening it in Diffusion Studio."); }}><Download size={14}/> Diffusion source</button></div></footer>
    </section>
    {details && <section className="setup" aria-label="Studio setup"><div className="setup-heading"><h2>Bring your own footage.</h2><button className="quiet" aria-label="Close studio setup" onClick={() => setDetails(false)}><X size={18}/></button></div><p>Import 8–12 clips you own. Files stay in your browser; Jev receives only the titles, tags, and transcripts you supply. Clips are muted and use their first two seconds.</p><div className="setup-controls"><input ref={files} type="file" accept="video/*" multiple hidden onChange={e => void importClips(e.target.files)}/><button disabled={disabled} onClick={() => files.current?.click()}><Upload size={16}/>{importing ? "Reading clips…" : "Import owned clips"}</button><label>Decision source<select value={mode} disabled={disabled} onChange={e => setMode(e.target.value as typeof mode)}><option value="fixture" disabled={!fixtures}>Authored fixture · no model</option><option value="jev">Hosted TypeSafe Jev</option></select></label><label>TypeSafe key<input type="password" autoComplete="off" placeholder="Session only" value={key} disabled={disabled} onChange={e => setKey(e.target.value)}/></label><button className="quiet" onClick={() => setKey("")}>Clear key</button></div><p className="muted">The key stays in memory and goes only through this local server to TypeSafe. This prototype has no open-model backend. Provider failure or an unclear choice preserves your cut.</p>
    <div className="library">{shots.map(shot => <div className="library-row" key={shot.id}><button className="quiet" disabled={disabled} onClick={() => setEditShot(editShot === shot.id ? null : shot.id)}>{shot.id} <span>{shot.name}</span><span>{shot.duration.toFixed(1)}s</span></button>{editShot === shot.id && <div className="tag-editor"><label>Describe what is actually in the shot<input maxLength={600} value={shot.tags} disabled={disabled} onChange={e => setShots(shots.map(s => s.id === shot.id ? { ...s, tags: e.target.value } : s))}/></label><label>Transcript (optional)<textarea maxLength={1000} value={shot.transcript} disabled={disabled} onChange={e => setShots(shots.map(s => s.id === shot.id ? { ...s, transcript: e.target.value } : s))}/></label></div>}</div>)}</div><details><summary>Last decision evidence</summary><p>Provider confidence and margin are uncalibrated prototype gates, not probabilities of a successful edit. Fixture choices are authored. Video comprehension, creative quality, novelty, and savings are unproven.</p><pre>{JSON.stringify(evidence, null, 2) ?? "No decision yet."}</pre><button disabled={!evidence} onClick={() => download("otto-cut.json", JSON.stringify({ current: { brief, fixtures, shots, cuts, lockedSlots: locks }, lastDecision: evidence }, null, 2), "application/json")}>Export cut + evidence</button></details></section>}
  </main>;
}
createRoot(document.getElementById("root")!).render(<App/>);
