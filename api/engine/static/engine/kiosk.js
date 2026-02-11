/**
 * Confessional Kiosk v0
 * - Records WAV (PCM 16-bit mono) in-browser
 * - Uploads to:
 *    ROOM/FOSSIL -> /api/v1/artifacts/audio
 *    NOSAVE     -> /api/v1/ephemeral/audio  (play once, then consume)
 * - Ambient loop pulls from /api/v1/pool/next and applies light decay per wear.
 */

const btnStart = document.getElementById("btnStart");
const btnStop = document.getElementById("btnStop");
const recStatus = document.getElementById("recStatus");
const preview = document.getElementById("preview");

const choices = Array.from(document.querySelectorAll(".choice"));
const btnSubmit = document.getElementById("btnSubmit");
const submitStatus = document.getElementById("submitStatus");
const receipt = document.getElementById("receipt");

const btnLoop = document.getElementById("btnLoop");
const btnLoopStop = document.getElementById("btnLoopStop");
const loopStatus = document.getElementById("loopStatus");

let selectedMode = null;
let wavBlob = null;
let durationMs = 0;

// --- Recording (WebAudio -> WAV) ---
let audioCtx = null;
let mediaStream = null;
let sourceNode = null;
let procNode = null;
let buffers = [];
let sampleRate = 44100;
let recStartTs = 0;

function setRecUI(state){
  if(state === "idle"){
    btnStart.disabled = false;
    btnStop.disabled = true;
    recStatus.textContent = "Idle";
  } else if(state === "recording"){
    btnStart.disabled = true;
    btnStop.disabled = false;
    recStatus.textContent = "Recording…";
  } else if(state === "ready"){
    btnStart.disabled = false;
    btnStop.disabled = true;
    recStatus.textContent = "Ready";
  }
}

async function startRecording(){
  buffers = [];
  wavBlob = null;
  durationMs = 0;
  preview.hidden = true;
  btnSubmit.disabled = true;
  submitStatus.textContent = "";
  receipt.textContent = "No receipt yet.";
  selectedMode = null;
  choices.forEach(c => c.classList.remove("selected"));

  mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  sampleRate = audioCtx.sampleRate;

  sourceNode = audioCtx.createMediaStreamSource(mediaStream);
  procNode = audioCtx.createScriptProcessor(4096, 1, 1);
  sourceNode.connect(procNode);
  procNode.connect(audioCtx.destination);

  procNode.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0);
    buffers.push(new Float32Array(input));
  };

  recStartTs = performance.now();
  setRecUI("recording");
}

function stopRecording(){
  if(!audioCtx) return;

  const recEndTs = performance.now();
  durationMs = Math.max(0, Math.round(recEndTs - recStartTs));

  procNode.disconnect();
  sourceNode.disconnect();
  mediaStream.getTracks().forEach(t => t.stop());

  // Flatten buffers
  const length = buffers.reduce((acc,b)=>acc+b.length,0);
  const data = new Float32Array(length);
  let offset = 0;
  for(const b of buffers){
    data.set(b, offset);
    offset += b.length;
  }

  wavBlob = encodeWavMono16(data, sampleRate);
  preview.src = URL.createObjectURL(wavBlob);
  preview.hidden = false;

  setRecUI("ready");
  btnSubmit.disabled = false;

  audioCtx.close();
  audioCtx = null;
}

function encodeWavMono16(float32Samples, sr){
  // PCM 16-bit mono WAV
  const numSamples = float32Samples.length;
  const bytesPerSample = 2;
  const blockAlign = bytesPerSample * 1;
  const byteRate = sr * blockAlign;
  const dataSize = numSamples * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  function writeStr(off, s){
    for(let i=0;i<s.length;i++) view.setUint8(off+i, s.charCodeAt(i));
  }

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);         // PCM header size
  view.setUint16(20, 1, true);          // audio format = PCM
  view.setUint16(22, 1, true);          // channels = 1
  view.setUint32(24, sr, true);         // sample rate
  view.setUint32(28, byteRate, true);   // byte rate
  view.setUint16(32, blockAlign, true); // block align
  view.setUint16(34, 16, true);         // bits per sample
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);

  let p = 44;
  for(let i=0;i<numSamples;i++){
    let s = Math.max(-1, Math.min(1, float32Samples[i]));
    const v = s < 0 ? s * 32768 : s * 32767;
    view.setInt16(p, v, true);
    p += 2;
  }
  return new Blob([view], { type: "audio/wav" });
}

btnStart.addEventListener("click", () => startRecording().catch(err => {
  recStatus.textContent = "Mic error: " + err.message;
}));
btnStop.addEventListener("click", stopRecording);
setRecUI("idle");

// --- Consent choice ---
choices.forEach(btn => {
  btn.addEventListener("click", () => {
    choices.forEach(c => c.classList.remove("selected"));
    btn.classList.add("selected");
    selectedMode = btn.dataset.mode;
  });
});

// --- Submit ---
btnSubmit.addEventListener("click", async () => {
  if(!wavBlob){
    submitStatus.textContent = "Record something first.";
    return;
  }
  if(!selectedMode){
    submitStatus.textContent = "Choose a memory mode.";
    return;
  }
  submitStatus.textContent = "Submitting…";

  if(selectedMode === "NOSAVE"){
    await submitNoSave();
  } else {
    await submitSave(selectedMode);
  }
});

async function submitSave(mode){
  const form = new FormData();
  form.append("file", wavBlob, "audio.wav");
  form.append("consent_mode", mode);
  form.append("duration_ms", String(durationMs));

  const res = await fetch("/api/v1/artifacts/audio", { method: "POST", body: form });
  if(!res.ok){
    submitStatus.textContent = "Error: " + res.status;
    return;
  }
  const j = await res.json();
  submitStatus.textContent = "Saved locally.";
  receipt.innerHTML = `
    <div><strong>Revocation code:</strong> <span style="color:#7ae3c3">${j.revocation_token}</span></div>
    <div class="muted">Keep this code. A steward can revoke it later on this node.</div>
    <div class="muted">Raw expires at: ${new Date(j.artifact.expires_at).toLocaleString()}</div>
  `;
}

async function submitNoSave(){
  const form = new FormData();
  form.append("file", wavBlob, "audio.wav");
  form.append("duration_ms", String(durationMs));

  const res = await fetch("/api/v1/ephemeral/audio", { method: "POST", body: form });
  if(!res.ok){
    submitStatus.textContent = "Error: " + res.status;
    return;
  }
  const j = await res.json();
  submitStatus.textContent = "Playing once (not saved).";
  receipt.textContent = "This recording will be discarded after playback.";

  // Play once immediately (no pool, no wear)
  await playUrlWithLightChain(j.play_url, 0.0);

  // Consume (delete)
  await fetch("/api/v1/ephemeral/consume", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ artifact_id: j.artifact_id, consume_token: j.consume_token })
  });

  submitStatus.textContent = "Discarded.";
}

async function fetchArrayBuffer(url){
  const r = await fetch(url, { cache: "no-store" });
  if(!r.ok) throw new Error("fetch failed " + r.status);
  return await r.arrayBuffer();
}

// --- Playback loop (pool) ---
let loopRunning = false;

btnLoop.addEventListener("click", async () => {
  loopRunning = true;
  btnLoop.disabled = true;
  btnLoopStop.disabled = false;
  loopStatus.textContent = "Running…";
  while(loopRunning){
    const r = await fetch("/api/v1/pool/next?context=kiosk", { cache: "no-store" });
    if(r.status === 204){
      loopStatus.textContent = "No sounds yet. Waiting…";
      await sleep(1500);
      continue;
    }
    if(!r.ok){
      loopStatus.textContent = "Pool error: " + r.status;
      await sleep(1500);
      continue;
    }
    const j = await r.json();
    loopStatus.textContent = `Playing #${j.artifact_id} (wear ${j.wear.toFixed(3)})`;
    await playUrlWithLightChain(j.audio_url, j.wear);
  }
  loopStatus.textContent = "Stopped";
});

btnLoopStop.addEventListener("click", () => {
  loopRunning = false;
  btnLoop.disabled = false;
  btnLoopStop.disabled = true;
});

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

// Light decay chain (wear-driven)

async function playUrlWithLightChain(url, wear){
  // wear in [0..1]
  // We use a smooth curve so early listens barely change anything,
  // and later listens add a gentle “patina” instead of harsh FX.
  const w = smoothstep(clamp(wear, 0, 1));

  const ab = await fetchArrayBuffer(url);
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const buf = await ctx.decodeAudioData(ab.slice(0));

  const src = ctx.createBufferSource();
  src.buffer = buf;

  // Filters: lose “air” gradually, never fully collapse.
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = lerp(16000, 4500, w);
  lp.Q.value = 0.6;

  const shelf = ctx.createBiquadFilter();
  shelf.type = "highshelf";
  shelf.frequency.value = 6000;
  shelf.gain.value = lerp(0, -10, w); // attenuate highs gently

  // Grain: subtle sample-hold + mild bit reduction (more “memory blur” than crunch)
  const crush = ctx.createScriptProcessor(1024, 1, 1);
  const bitDepth = Math.round(lerp(16, 12, w));       // stays subtle
  const step = Math.pow(0.5, bitDepth);
  const holdN = Math.round(lerp(1, 3, w));            // sample-hold factor (1..3)
  const noiseAmp = lerp(0.0, 0.004, w);               // gentle hiss floor
  const dropoutProb = lerp(0.0, 0.003, w);            // extremely light dust (no obvious holes)

  let holdCounter = 0;
  let held = 0.0;

  crush.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0);
    const output = e.outputBuffer.getChannelData(0);
    for(let i=0;i<input.length;i++){
      // Sample-hold
      if(holdCounter === 0){
        held = input[i];
      }
      holdCounter = (holdCounter + 1) % holdN;

      // Quantize (bit reduction)
      let s = Math.round(held / step) * step;

      // Dust (rare)
      if(Math.random() < dropoutProb) s = 0.0;

      // Hiss (very low)
      s += (Math.random() * 2 - 1) * noiseAmp;

      output[i] = s;
    }
  };

  // Subtle, slow wobble of the lowpass cutoff (like attention drifting)
  const lfo = ctx.createOscillator();
  lfo.type = "sine";
  lfo.frequency.value = lerp(0.05, 0.12, w); // very slow
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = lerp(0, 180, w);      // small modulation in Hz
  lfo.connect(lfoGain);
  lfoGain.connect(lp.frequency);

  const gain = ctx.createGain();
  gain.gain.value = 0.95;

  src.connect(lp);
  lp.connect(shelf);
  shelf.connect(crush);
  crush.connect(gain);
  gain.connect(ctx.destination);

  lfo.start();

  return new Promise((resolve) => {
    src.onended = async () => {
      try { lfo.stop(); } catch(e){}
      try { lfo.disconnect(); } catch(e){}
      try { lfoGain.disconnect(); } catch(e){}
      try { crush.disconnect(); } catch(e){}
      try { shelf.disconnect(); } catch(e){}
      try { lp.disconnect(); } catch(e){}
      try { gain.disconnect(); } catch(e){}
      await ctx.close();
      resolve();
    };
    src.start();
  });
}

function lerp(a,b,t){ return a + (b-a)*t; }
function clamp(x,a,b){ return Math.max(a, Math.min(b, x)); }
function smoothstep(t){ return t*t*(3-2*t); }

function lerp(a,b,t){ return a + (b-a)*t; }
function clamp(x,a,b){ return Math.max(a, Math.min(b, x)); }
