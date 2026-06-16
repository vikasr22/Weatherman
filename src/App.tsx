import { useState, useEffect, useRef, useCallback } from "react";
import axios from "axios";
import "./styles.css";

/* ─── Types ─────────────────────────────────────────────── */
interface WeatherData {
  name: string;
  timezone: number; // UTC offset in seconds
  sys: { country: string; sunrise: number; sunset: number };
  weather: { icon: string; description: string; id: number }[];
  main: {
    temp: number;
    humidity: number;
    feels_like: number;
    temp_min: number;
    temp_max: number;
    pressure: number;
  };
  wind: { speed: number; deg: number };
  visibility: number;
}

interface CitySuggestion {
  name: string;
  lat: number;
  lon: number;
  country: string;
  state?: string;
}

/* ─── Weather scene type ─────────────────────────────────── */
type Scene =
  | "night"
  | "sunrise"
  | "sunset"
  | "day-clear"
  | "day-hot"
  | "day-cloudy"
  | "rain"
  | "heavy-rain"
  | "thunder"
  | "snow"
  | "fog"
  | "default";

function getScene(weather: WeatherData | null): Scene {
  if (!weather) return "default";

  const nowUtc = Date.now() / 1000;
  const localNow = nowUtc + weather.timezone;
  const sunrise  = weather.sys.sunrise + weather.timezone;
  const sunset   = weather.sys.sunset  + weather.timezone;
  const id       = weather.weather[0].id;
  const temp     = weather.main.temp;

  const isNight   = localNow < sunrise - 1800 || localNow > sunset + 1800;
  const isSunrise = !isNight && localNow < sunrise + 2400;
  const isSunset  = !isNight && localNow > sunset - 2400;

  // Weather condition overrides time of day
  if (id >= 200 && id < 300) return "thunder";
  if (id >= 502 && id < 600) return "heavy-rain";
  if (id >= 300 && id < 600) return "rain";
  if (id >= 600 && id < 700) return "snow";
  if (id >= 700 && id < 800) return "fog";

  if (isNight)   return "night";
  if (isSunrise) return "sunrise";
  if (isSunset)  return "sunset";
  if (id === 800 && temp >= 35) return "day-hot";
  if (id === 800 || id === 801) return "day-clear";
  return "day-cloudy";
}

/* ─── Lerp helper ─────────────────────────────────────────── */
function lerpColor(a: [number,number,number], b: [number,number,number], t: number): string {
  const r = Math.round(a[0] + (b[0]-a[0])*t);
  const g = Math.round(a[1] + (b[1]-a[1])*t);
  const bl = Math.round(a[2] + (b[2]-a[2])*t);
  return `rgb(${r},${g},${bl})`;
}

/* ─── Dynamic Weather Canvas ─────────────────────────────── */
function WeatherCanvas({ scene }: { scene: Scene }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef(scene);
  sceneRef.current = scene;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    let raf: number;
    let t = 0;

    const resize = () => {
      canvas.width  = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    /* ── Shared particle pools ── */
    // Stars (night / thunder)
    const stars = Array.from({ length: 180 }, () => ({
      x: Math.random(), y: Math.random() * 0.75,
      r: Math.random() * 1.3 + 0.2,
      alpha: Math.random() * 0.6 + 0.1,
      phase: Math.random() * Math.PI * 2,
    }));

    // Clouds
    const clouds = Array.from({ length: 7 }, (_, i) => ({
      x: Math.random(),
      y: 0.05 + Math.random() * 0.35,
      w: 0.18 + Math.random() * 0.22,
      h: 0.06 + Math.random() * 0.08,
      speed: 0.00004 + Math.random() * 0.00006,
      alpha: 0.55 + Math.random() * 0.35,
      puffs: Array.from({ length: 5 }, () => ({
        dx: (Math.random() - 0.5) * 0.8,
        dy: (Math.random() - 0.3) * 0.4,
        rs: 0.5 + Math.random() * 0.6,
      })),
    }));

    // Rain drops
    const drops = Array.from({ length: 280 }, () => ({
      x: Math.random(),
      y: Math.random(),
      len: 0.03 + Math.random() * 0.06,
      speed: 0.008 + Math.random() * 0.012,
      alpha: 0.25 + Math.random() * 0.4,
    }));

    // Heavy rain
    const heavyDrops = Array.from({ length: 500 }, () => ({
      x: Math.random(),
      y: Math.random(),
      len: 0.05 + Math.random() * 0.09,
      speed: 0.014 + Math.random() * 0.018,
      alpha: 0.3 + Math.random() * 0.45,
    }));

    // Snow flakes
    const flakes = Array.from({ length: 200 }, () => ({
      x: Math.random(),
      y: Math.random(),
      r: 1 + Math.random() * 2.5,
      speed: 0.0008 + Math.random() * 0.002,
      drift: (Math.random() - 0.5) * 0.0008,
      alpha: 0.4 + Math.random() * 0.5,
      phase: Math.random() * Math.PI * 2,
    }));

    // Heat shimmer particles
    const heatWaves = Array.from({ length: 40 }, () => ({
      x: Math.random(),
      y: 0.5 + Math.random() * 0.5,
      amp: 0.003 + Math.random() * 0.006,
      freq: 1 + Math.random() * 3,
      speed: 0.0004 + Math.random() * 0.0006,
      phase: Math.random() * Math.PI * 2,
      alpha: 0.03 + Math.random() * 0.06,
    }));

    // Lightning state
    let lightningFlash = 0;
    let nextLightning = 2 + Math.random() * 4;

    /* ── Sky gradient helper ── */
    const skyGrad = (colors: [string, ...string[]]) => {
      const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
      colors.forEach((c, i) => g.addColorStop(i / (colors.length - 1), c));
      return g;
    };

    /* ── Draw cloud shape ── */
    const drawCloud = (cx: number, cy: number, w: number, h: number, alpha: number, color: string, puffs: {dx:number,dy:number,rs:number}[]) => {
      const { width: cw, height: ch } = canvas;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      puffs.forEach(p => {
        ctx.beginPath();
        ctx.ellipse(cx + p.dx * w * cw, cy + p.dy * h * ch, w * cw * p.rs * 0.5, h * ch * p.rs * 0.6, 0, 0, Math.PI * 2);
        ctx.fill();
      });
      // Core body
      ctx.beginPath();
      ctx.ellipse(cx, cy, w * cw * 0.5, h * ch * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };

    /* ── Main draw loop ── */
    const draw = () => {
      const sc = sceneRef.current;
      const { width: w, height: h } = canvas;
      ctx.clearRect(0, 0, w, h);
      t += 1;
      const ts = t * 0.01;

      /* ════ NIGHT ════ */
      if (sc === "night") {
        ctx.fillStyle = skyGrad(["#020510", "#060d1f", "#0b1535", "#0d1a3a"]);
        ctx.fillRect(0, 0, w, h);
        // Moon
        const mx = w * 0.82, my = h * 0.14, mr = Math.min(w,h)*0.045;
        const mg = ctx.createRadialGradient(mx, my, 0, mx, my, mr*2.5);
        mg.addColorStop(0, "rgba(220,230,255,0.18)");
        mg.addColorStop(1, "transparent");
        ctx.fillStyle = mg; ctx.fillRect(0,0,w,h);
        ctx.beginPath(); ctx.arc(mx, my, mr, 0, Math.PI*2);
        ctx.fillStyle = "#d8e4ff"; ctx.fill();
        ctx.beginPath(); ctx.arc(mx + mr*0.3, my - mr*0.1, mr*0.82, 0, Math.PI*2);
        ctx.fillStyle = "#060d1f"; ctx.fill();
        // Stars
        stars.forEach(s => {
          const pulse = Math.sin(ts * 1.2 + s.phase) * 0.25 + 0.75;
          ctx.beginPath(); ctx.arc(s.x*w, s.y*h, s.r, 0, Math.PI*2);
          ctx.fillStyle = `rgba(255,255,255,${s.alpha * pulse})`; ctx.fill();
        });
        // Subtle aurora at horizon
        const aur = ctx.createLinearGradient(0, h*0.55, 0, h);
        aur.addColorStop(0, "rgba(30,80,60,0.07)");
        aur.addColorStop(1, "transparent");
        ctx.fillStyle = aur; ctx.fillRect(0,0,w,h);
      }

      /* ════ SUNRISE ════ */
      else if (sc === "sunrise") {
        ctx.fillStyle = skyGrad(["#0d1a3a","#1a2a6c","#b21f1f","#fdbb2d","#ffe0a0"]);
        ctx.fillRect(0, 0, w, h);
        // Sun peeking at horizon
        const sx = w*0.5, sy = h*0.82;
        const sunG = ctx.createRadialGradient(sx,sy,0,sx,sy,w*0.25);
        sunG.addColorStop(0,"rgba(255,230,80,0.9)");
        sunG.addColorStop(0.3,"rgba(255,160,30,0.5)");
        sunG.addColorStop(1,"transparent");
        ctx.fillStyle = sunG; ctx.fillRect(0,0,w,h);
        ctx.beginPath(); ctx.arc(sx, sy+h*0.02, Math.min(w,h)*0.055, 0, Math.PI*2);
        ctx.fillStyle="#fff8c0"; ctx.fill();
        // Clouds tinted orange/pink
        clouds.forEach(c => {
          c.x = (c.x + c.speed) % 1.15;
          drawCloud(c.x*w, c.y*h, c.w, c.h, c.alpha*0.7, "#ffb86c", c.puffs);
        });
        // Stars still visible faintly
        stars.slice(0,50).forEach(s => {
          const pulse = Math.sin(ts + s.phase) * 0.2 + 0.4;
          ctx.beginPath(); ctx.arc(s.x*w, s.y*h*0.5, s.r*0.7, 0, Math.PI*2);
          ctx.fillStyle = `rgba(255,255,255,${s.alpha * pulse * 0.4})`; ctx.fill();
        });
      }

      /* ════ SUNSET ════ */
      else if (sc === "sunset") {
        ctx.fillStyle = skyGrad(["#0f0c29","#302b63","#24243e","#c94b4b","#f7971e","#ffd200"]);
        ctx.fillRect(0, 0, w, h);
        // Sun at horizon
        const sx = w*0.72, sy = h*0.78;
        const sunG = ctx.createRadialGradient(sx,sy,0,sx,sy,w*0.3);
        sunG.addColorStop(0,"rgba(255,210,0,0.85)");
        sunG.addColorStop(0.25,"rgba(249,120,30,0.5)");
        sunG.addColorStop(1,"transparent");
        ctx.fillStyle = sunG; ctx.fillRect(0,0,w,h);
        ctx.beginPath(); ctx.arc(sx, sy, Math.min(w,h)*0.05, 0, Math.PI*2);
        ctx.fillStyle="#ffe066"; ctx.fill();
        // Purple-tinted clouds
        clouds.forEach(c => {
          c.x = (c.x + c.speed*0.6) % 1.15;
          drawCloud(c.x*w, c.y*h, c.w, c.h, c.alpha*0.65, "#c87941", c.puffs);
        });
      }

      /* ════ DAY-CLEAR ════ */
      else if (sc === "day-clear") {
        ctx.fillStyle = skyGrad(["#1a6fa8","#2a96e8","#4ab8f8","#87ceeb"]);
        ctx.fillRect(0, 0, w, h);
        // Sun
        const sx = w*0.8, sy = h*0.12;
        const sunG = ctx.createRadialGradient(sx,sy,0,sx,sy,w*0.18);
        sunG.addColorStop(0,"rgba(255,248,180,0.45)");
        sunG.addColorStop(1,"transparent");
        ctx.fillStyle = sunG; ctx.fillRect(0,0,w,h);
        ctx.beginPath(); ctx.arc(sx, sy, Math.min(w,h)*0.042, 0, Math.PI*2);
        ctx.fillStyle="#fffbe0"; ctx.fill();
        // Sparse white clouds
        clouds.slice(0,4).forEach(c => {
          c.x = (c.x + c.speed*0.7) % 1.15;
          drawCloud(c.x*w, c.y*h, c.w, c.h, c.alpha*0.6, "#ffffff", c.puffs);
        });
      }

      /* ════ DAY-HOT ════ */
      else if (sc === "day-hot") {
        ctx.fillStyle = skyGrad(["#b5651d","#d4881a","#f5b942","#fde68a","#fff8c0"]);
        ctx.fillRect(0, 0, w, h);
        // Blazing sun
        const sx = w*0.78, sy = h*0.10;
        const sunG = ctx.createRadialGradient(sx,sy,0,sx,sy,w*0.3);
        sunG.addColorStop(0,"rgba(255,220,50,0.7)");
        sunG.addColorStop(0.4,"rgba(255,140,0,0.3)");
        sunG.addColorStop(1,"transparent");
        ctx.fillStyle = sunG; ctx.fillRect(0,0,w,h);
        ctx.beginPath(); ctx.arc(sx, sy, Math.min(w,h)*0.065, 0, Math.PI*2);
        ctx.fillStyle="#fff200"; ctx.fill();
        // Heat shimmer lines rising from bottom
        heatWaves.forEach(hv => {
          hv.y -= hv.speed;
          if (hv.y < 0.3) hv.y = 0.9 + Math.random()*0.1;
          const waveX = hv.x*w + Math.sin(ts*hv.freq + hv.phase)*hv.amp*w;
          const wg = ctx.createLinearGradient(waveX, hv.y*h, waveX, hv.y*h - h*0.12);
          wg.addColorStop(0, `rgba(255,200,50,${hv.alpha})`);
          wg.addColorStop(1, "transparent");
          ctx.strokeStyle = wg; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(waveX, hv.y*h);
          ctx.bezierCurveTo(waveX + 8, hv.y*h - h*0.04, waveX - 6, hv.y*h - h*0.08, waveX + 3, hv.y*h - h*0.12);
          ctx.stroke();
        });
      }

      /* ════ DAY-CLOUDY ════ */
      else if (sc === "day-cloudy") {
        ctx.fillStyle = skyGrad(["#4a6fa5","#6b8cba","#8fadc8","#b0c8d8","#ccdde8"]);
        ctx.fillRect(0, 0, w, h);
        clouds.forEach(c => {
          c.x = (c.x + c.speed*0.5) % 1.15;
          drawCloud(c.x*w, c.y*h, c.w*1.2, c.h*1.2, c.alpha*0.75, "#dce8f0", c.puffs);
        });
      }

      /* ════ RAIN ════ */
      else if (sc === "rain") {
        ctx.fillStyle = skyGrad(["#1a2030","#253050","#2e3a5a","#384260"]);
        ctx.fillRect(0, 0, w, h);
        // Heavy cloud layer
        clouds.forEach(c => {
          c.x = (c.x + c.speed*0.3) % 1.15;
          drawCloud(c.x*w, c.y*h*0.6, c.w*1.4, c.h*1.5, c.alpha*0.8, "#2a3040", c.puffs);
        });
        // Rain streaks
        ctx.save();
        drops.forEach(d => {
          d.y += d.speed;
          if (d.y > 1) { d.y = -0.05; d.x = Math.random(); }
          ctx.beginPath();
          ctx.moveTo(d.x*w, d.y*h);
          ctx.lineTo(d.x*w - 1.5, (d.y+d.len)*h);
          ctx.strokeStyle = `rgba(160,200,255,${d.alpha})`;
          ctx.lineWidth = 0.8; ctx.stroke();
        });
        ctx.restore();
      }

      /* ════ HEAVY RAIN ════ */
      else if (sc === "heavy-rain") {
        ctx.fillStyle = skyGrad(["#0d1018","#141a28","#1a2235","#202838"]);
        ctx.fillRect(0, 0, w, h);
        clouds.forEach(c => {
          c.x = (c.x + c.speed*0.2) % 1.15;
          drawCloud(c.x*w, c.y*h*0.5, c.w*1.6, c.h*1.8, 0.9, "#161e2a", c.puffs);
        });
        ctx.save();
        heavyDrops.forEach(d => {
          d.y += d.speed;
          if (d.y > 1.05) { d.y = -0.08; d.x = Math.random(); }
          ctx.beginPath();
          ctx.moveTo(d.x*w, d.y*h);
          ctx.lineTo(d.x*w - 3, (d.y+d.len)*h);
          ctx.strokeStyle = `rgba(140,190,255,${d.alpha})`;
          ctx.lineWidth = 1.2; ctx.stroke();
        });
        ctx.restore();
        // Splash ripples at bottom
        for (let i = 0; i < 6; i++) {
          const rx = ((i*0.17 + ts*0.05) % 1)*w;
          const ry = h * 0.96;
          const rs = ((ts*0.8 + i) % 1)*20;
          ctx.beginPath();
          ctx.ellipse(rx, ry, rs*1.5, rs*0.3, 0, 0, Math.PI*2);
          ctx.strokeStyle = `rgba(160,210,255,${0.3*(1-rs/20)})`;
          ctx.lineWidth = 0.8; ctx.stroke();
        }
      }

      /* ════ THUNDER ════ */
      else if (sc === "thunder") {
        // Lightning flash overlay
        nextLightning -= 0.016;
        if (nextLightning <= 0) {
          lightningFlash = 0.4 + Math.random()*0.4;
          nextLightning = 1.5 + Math.random()*5;
        }
        if (lightningFlash > 0) lightningFlash -= 0.04;

        const flashAlpha = Math.max(0, lightningFlash);
        ctx.fillStyle = skyGrad(["#05080f","#0a0f1a","#0f1525","#131928"]);
        ctx.fillRect(0, 0, w, h);

        // Lightning bolt
        if (flashAlpha > 0.1) {
          ctx.save();
          ctx.globalAlpha = flashAlpha;
          // Illuminate whole sky
          const fl = ctx.createRadialGradient(w*0.4, 0, 0, w*0.4, 0, w*0.8);
          fl.addColorStop(0, "rgba(200,220,255,0.6)");
          fl.addColorStop(1, "transparent");
          ctx.fillStyle = fl; ctx.fillRect(0,0,w,h);
          // Draw jagged bolt
          const bx = w*(0.3 + Math.random()*0.4);
          ctx.strokeStyle = "#e8f0ff"; ctx.lineWidth = 2.5;
          ctx.shadowColor = "#a0c0ff"; ctx.shadowBlur = 18;
          ctx.beginPath(); ctx.moveTo(bx, 0);
          let by = 0;
          while (by < h*0.65) {
            by += 18 + Math.random()*30;
            ctx.lineTo(bx + (Math.random()-0.5)*60, by);
          }
          ctx.stroke();
          ctx.restore();
        }

        clouds.forEach(c => {
          c.x = (c.x + c.speed*0.15) % 1.15;
          drawCloud(c.x*w, c.y*h*0.45, c.w*1.8, c.h*2, 0.92, "#0a0e18", c.puffs);
        });
        ctx.save();
        heavyDrops.forEach(d => {
          d.y += d.speed*1.3;
          if (d.y > 1.05) { d.y = -0.08; d.x = Math.random(); }
          ctx.beginPath();
          ctx.moveTo(d.x*w, d.y*h);
          ctx.lineTo(d.x*w - 4, (d.y+d.len*1.2)*h);
          ctx.strokeStyle = `rgba(120,170,255,${d.alpha*0.9})`;
          ctx.lineWidth = 1.4; ctx.stroke();
        });
        ctx.restore();
        stars.slice(0,20).forEach(s => {
          if (flashAlpha > 0.2) {
            ctx.beginPath(); ctx.arc(s.x*w, s.y*h*0.3, s.r, 0, Math.PI*2);
            ctx.fillStyle = `rgba(255,255,255,${flashAlpha*0.5})`; ctx.fill();
          }
        });
      }

      /* ════ SNOW ════ */
      else if (sc === "snow") {
        ctx.fillStyle = skyGrad(["#1a2030","#2a3248","#3a4560","#4a5570"]);
        ctx.fillRect(0, 0, w, h);
        clouds.forEach(c => {
          c.x = (c.x + c.speed*0.2) % 1.15;
          drawCloud(c.x*w, c.y*h*0.55, c.w*1.3, c.h*1.4, 0.7, "#7080a0", c.puffs);
        });
        flakes.forEach(f => {
          f.y += f.speed;
          f.x += f.drift + Math.sin(ts*0.5 + f.phase)*0.0003;
          if (f.y > 1.02) { f.y = -0.02; f.x = Math.random(); }
          if (f.x > 1.02) f.x = 0; if (f.x < -0.02) f.x = 1;
          const pulse = Math.sin(ts*2 + f.phase)*0.15 + 0.85;
          ctx.beginPath(); ctx.arc(f.x*w, f.y*h, f.r, 0, Math.PI*2);
          ctx.fillStyle = `rgba(220,235,255,${f.alpha*pulse})`; ctx.fill();
        });
      }

      /* ════ FOG ════ */
      else if (sc === "fog") {
        ctx.fillStyle = skyGrad(["#555f6b","#6b7680","#808c96","#909ca6"]);
        ctx.fillRect(0, 0, w, h);
        // Fog layers drifting
        for (let i = 0; i < 5; i++) {
          const fy = h*(0.2 + i*0.18);
          const fx = ((ts*0.012*(i%2===0?1:-1) + i*0.3) % 1.5 - 0.25)*w;
          const fg = ctx.createRadialGradient(fx + w*0.5, fy, 0, fx + w*0.5, fy, w*0.6);
          fg.addColorStop(0,`rgba(200,210,215,${0.12+i*0.03})`);
          fg.addColorStop(1,"transparent");
          ctx.fillStyle = fg; ctx.fillRect(0,0,w,h);
        }
      }

      /* ════ DEFAULT (no weather loaded) ════ */
      else {
        ctx.fillStyle = skyGrad(["#020510","#060d1f","#0b1535"]);
        ctx.fillRect(0, 0, w, h);
        stars.forEach(s => {
          const pulse = Math.sin(ts * 1.2 + s.phase)*0.25 + 0.75;
          ctx.beginPath(); ctx.arc(s.x*w, s.y*h, s.r, 0, Math.PI*2);
          ctx.fillStyle = `rgba(255,255,255,${s.alpha * pulse})`; ctx.fill();
        });
      }

      raf = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={ref} className="bg-canvas" />;
}

/* ─── Helpers ────────────────────────────────────────────── */
function fmtTime(unix: number): string {
  return new Date(unix * 1000).toLocaleTimeString([], {
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

function fmtClock(d: Date): string {
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

// Renders the live local time at the searched city, using its UTC offset
// rather than the visitor's own device timezone.
function fmtCityClock(nowMs: number, tzOffsetSeconds: number): string {
  const shifted = new Date(nowMs + tzOffsetSeconds * 1000);
  return shifted.toLocaleTimeString([], {
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "UTC",
  });
}

function uvFromWeatherId(id: number): number {
  if (id >= 800) return 7;
  if (id >= 700) return 2;
  if (id >= 600) return 1;
  if (id >= 500) return 2;
  if (id >= 300) return 3;
  return 4;
}

function uvLabel(uv: number): string {
  if (uv <= 2) return "Low";
  if (uv <= 5) return "Moderate";
  if (uv <= 7) return "High";
  if (uv <= 10) return "Very High";
  return "Extreme";
}

/* ─── Wind compass dial ──────────────────────────────────── */
function WindDial({ deg, speed }: { deg: number; speed: number }) {
  const dirs = ["N", "E", "S", "W"];
  const r = 54, cx = 60, cy = 60;
  const ticks = Array.from({ length: 36 }, (_, i) => {
    const angle = (i / 36) * 360;
    const rad = (angle * Math.PI) / 180;
    const major = i % 9 === 0;
    const inner = r - (major ? 8 : 4), outer = r - 1;
    return {
      x1: cx + inner * Math.sin(rad), y1: cy - inner * Math.cos(rad),
      x2: cx + outer * Math.sin(rad), y2: cy - outer * Math.cos(rad), major,
    };
  });
  const needleRad = (deg * Math.PI) / 180;
  const needleLen = r - 12;
  return (
    <div className="dial-wrap">
      <svg viewBox="0 0 120 120" className="dial-svg">
        <circle cx={cx} cy={cy} r={r} className="dial-ring" />
        <circle cx={cx} cy={cy} r={r - 2} className="dial-inner" />
        {ticks.map((tk, i) => (
          <line key={i} x1={tk.x1} y1={tk.y1} x2={tk.x2} y2={tk.y2}
            className={tk.major ? "tick-major" : "tick-minor"} />
        ))}
        {dirs.map((d, i) => {
          const a = (i / 4) * 2 * Math.PI, lr = r - 18;
          return (
            <text key={d} x={cx + lr * Math.sin(a)} y={cy - lr * Math.cos(a) + 2.5}
              textAnchor="middle" className="dial-label">{d}</text>
          );
        })}
        <line x1={cx} y1={cy}
          x2={cx - (needleLen*0.4)*Math.sin(needleRad)} y2={cy + (needleLen*0.4)*Math.cos(needleRad)}
          stroke="rgba(255,255,255,0.18)" strokeWidth="1.5" />
        <line x1={cx} y1={cy}
          x2={cx + needleLen*Math.sin(needleRad)} y2={cy - needleLen*Math.cos(needleRad)}
          className="needle" />
        <circle cx={cx} cy={cy} r={3} className="needle-hub" />
      </svg>
      <div className="dial-value">{speed.toFixed(1)}<span className="dial-unit"> m/s</span></div>
    </div>
  );
}

/* ─── Icons ──────────────────────────────────────────────── */
const SearchIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
    <circle cx="11" cy="11" r="7" /><line x1="16.5" y1="16.5" x2="21" y2="21" />
  </svg>
);
const SpinIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="spin">
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </svg>
);
const CloudIcon = () => (
  <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" className="empty-icon">
    <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
  </svg>
);
const SunriseIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2v2M4.93 4.93l1.41 1.41M20.07 4.93l-1.41 1.41M3 12h2M19 12h2" />
    <path d="M12 6a6 6 0 0 1 6 6H6a6 6 0 0 1 6-6z" />
    <line x1="2" y1="20" x2="22" y2="20" />
    <polyline points="5 17 7 15" /><polyline points="19 17 17 15" />
  </svg>
);
const SunsetIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 10v2M4.93 4.93l1.41 1.41M20.07 4.93l-1.41 1.41M3 12h2M19 12h2" />
    <path d="M12 6a6 6 0 0 1 6 6H6a6 6 0 0 1 6-6z" />
    <line x1="2" y1="20" x2="22" y2="20" />
    <polyline points="7 15 5 17" /><polyline points="17 15 19 17" />
  </svg>
);
const ClockIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3.5 2" />
  </svg>
);

/* ─── App ────────────────────────────────────────────────── */
export default function App() {
  const [city, setCity] = useState("");
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [clock, setClock] = useState(new Date());
  const [suggestions, setSuggestions] = useState<CitySuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggLoading, setSuggLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchBlockRef = useRef<HTMLDivElement>(null);
  const skipNextLookupRef = useRef(false);
  const API_KEY = "e707cf0cf6c6b09c949bb02e32bf1c42";

  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Close the suggestions dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (searchBlockRef.current && !searchBlockRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Debounced city-suggestion lookup as the user types
  useEffect(() => {
    if (skipNextLookupRef.current) { skipNextLookupRef.current = false; return; }
    const query = city.trim();
    if (query.length < 2) { setSuggestions([]); setShowSuggestions(false); return; }

    const id = setTimeout(async () => {
      try {
        setSuggLoading(true);
        const res = await axios.get<CitySuggestion[]>(
          `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(query)}&limit=5&appid=${API_KEY}`
        );
        setSuggestions(res.data);
        setShowSuggestions(res.data.length > 0);
        setActiveIndex(-1);
      } catch {
        setSuggestions([]);
      } finally {
        setSuggLoading(false);
      }
    }, 300);

    return () => clearTimeout(id);
  }, [city]);

  const fetchWeather = useCallback(async () => {
    setShowSuggestions(false);
    if (!city.trim()) { setError("Enter a city name to get started"); setWeather(null); return; }
    try {
      setLoading(true); setError("");
      const res = await axios.get<WeatherData>(
        `https://api.openweathermap.org/data/2.5/weather?q=${city.trim()}&appid=${API_KEY}&units=metric`
      );
      setWeather(res.data);
    } catch {
      setWeather(null);
      setError("City not found — check the spelling and try again");
    } finally { setLoading(false); }
  }, [city]);

  const fetchWeatherByCoords = useCallback(async (lat: number, lon: number) => {
    try {
      setLoading(true); setError("");
      const res = await axios.get<WeatherData>(
        `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${API_KEY}&units=metric`
      );
      setWeather(res.data);
    } catch {
      setWeather(null);
      setError("Couldn't load weather for that location — try again");
    } finally { setLoading(false); }
  }, []);

  const handleSelectSuggestion = useCallback((s: CitySuggestion) => {
    skipNextLookupRef.current = true;
    setCity(s.name);
    setSuggestions([]);
    setShowSuggestions(false);
    setActiveIndex(-1);
    fetchWeatherByCoords(s.lat, s.lon);
    inputRef.current?.blur();
  }, [fetchWeatherByCoords]);

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (showSuggestions && suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % suggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
        return;
      }
      if (e.key === "Escape") { setShowSuggestions(false); return; }
      if (e.key === "Enter") {
        e.preventDefault();
        if (activeIndex >= 0) handleSelectSuggestion(suggestions[activeIndex]);
        else fetchWeather();
        return;
      }
    } else if (e.key === "Enter") {
      fetchWeather();
    }
  };

  const scene = getScene(weather);
  const uv = weather ? uvFromWeatherId(weather.weather[0].id) : 0;
  const cityTime = weather ? fmtCityClock(clock.getTime(), weather.timezone) : "";

  return (
    <div className="app">
      <WeatherCanvas scene={scene} />

      <div className="shell">
        <div className="topbar">
          <div className="brand">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
            </svg>
            Climate
          </div>
          <div className="topbar-time">{fmtClock(clock)}</div>
        </div>

        <div className="search-block" ref={searchBlockRef}>
          <div className="search-row">
            <input ref={inputRef} className="search-input" type="text" placeholder="Search city…"
              value={city}
              onChange={(e) => { setCity(e.target.value); setShowSuggestions(true); }}
              onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true); }}
              onKeyDown={handleInputKeyDown}
              autoComplete="off" spellCheck={false}
              role="combobox" aria-expanded={showSuggestions} aria-autocomplete="list" />
            <button className="search-btn" onClick={fetchWeather} disabled={loading} aria-label="Search">
              {loading ? <SpinIcon /> : <SearchIcon />}
            </button>
          </div>

          {showSuggestions && (suggLoading || suggestions.length > 0) && (
            <ul className="suggestions-list" role="listbox">
              {suggLoading && suggestions.length === 0 && (
                <li className="suggestion-item suggestion-loading">
                  <SpinIcon />
                  <span className="suggestion-name">Searching cities…</span>
                </li>
              )}
              {suggestions.map((s, i) => (
                <li key={`${s.lat}-${s.lon}-${i}`}
                  role="option" aria-selected={i === activeIndex}
                  className={`suggestion-item ${i === activeIndex ? "active" : ""}`}
                  onMouseDown={(e) => { e.preventDefault(); handleSelectSuggestion(s); }}
                  onMouseEnter={() => setActiveIndex(i)}>
                  <SearchIcon />
                  <span className="suggestion-name">
                    {s.name}{s.state ? `, ${s.state}` : ""}
                  </span>
                  <span className="suggestion-country">{s.country}</span>
                </li>
              ))}
            </ul>
          )}

          {error && <div className="error-msg">{error}</div>}
        </div>

        {!weather ? (
          <div className="empty-state">
            <CloudIcon />
            <p>Search for a city to see its weather</p>
          </div>
        ) : (
          <div className="weather-grid fade-in">
            <div className="card hero-card">
              <div className="card-label">Current conditions</div>
              <div className="hero-location">
                <span className="hero-city">{weather.name}</span>
                <span className="hero-country">{weather.sys.country}</span>
              </div>
              <div className="hero-localtime">
                <ClockIcon />
                <span>{cityTime} local time</span>
              </div>
              <div className="hero-main">
                <img className="hero-icon"
                  src={`https://openweathermap.org/img/wn/${weather.weather[0].icon}@4x.png`}
                  alt={weather.weather[0].description} />
                <div>
                  <div className="hero-temp-block">
                    <span className="hero-temp">{Math.round(weather.main.temp)}</span>
                    <span className="hero-unit">°C</span>
                  </div>
                  <div className="hero-desc">{weather.weather[0].description}</div>
                  <div className="hero-range">
                    <span>↑ {Math.round(weather.main.temp_max)}°</span>
                    <span className="dot-sep">·</span>
                    <span>↓ {Math.round(weather.main.temp_min)}°</span>
                    <span className="dot-sep">·</span>
                    <span>Feels {Math.round(weather.main.feels_like)}°</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="card wind-card">
              <div className="card-label">Wind</div>
              <WindDial deg={weather.wind.deg} speed={weather.wind.speed} />
              <div className="card-sub" style={{ textAlign: "center", marginTop: 6 }}>
                {weather.wind.deg}° bearing
              </div>
            </div>

            <div className="card humidity-card">
              <div className="card-label">Humidity</div>
              <div className="big-value">{weather.main.humidity}<span className="big-unit">%</span></div>
              <div className="hbar-wrap">
                <div className="hbar-track">
                  <div className="hbar-fill" style={{ width: `${weather.main.humidity}%` }} />
                </div>
                <div className="hbar-labels"><span>0</span><span>50</span><span>100</span></div>
              </div>
              <div className="card-sub">
                {weather.main.humidity < 30 ? "Dry air — consider a humidifier"
                  : weather.main.humidity > 70 ? "High moisture in the air"
                  : "Comfortable humidity"}
              </div>
            </div>

            <div className="card sun-card">
              <div className="card-label">Daylight</div>
              <div className="sun-row">
                <div className="sun-item">
                  <SunriseIcon />
                  <span className="sun-label">Sunrise</span>
                  <span className="sun-time">{fmtTime(weather.sys.sunrise)}</span>
                </div>
                <div className="sun-divider" />
                <div className="sun-item">
                  <SunsetIcon />
                  <span className="sun-label">Sunset</span>
                  <span className="sun-time">{fmtTime(weather.sys.sunset)}</span>
                </div>
              </div>
            </div>

            <div className="card uv-card">
              <div className="card-label">UV Index</div>
              <div className="uv-val">{uv}</div>
              <div className="card-sub">{uvLabel(uv)}</div>
            </div>

            <div className="card pressure-card">
              <div className="card-label">Pressure</div>
              <div className="big-value">{weather.main.pressure}<span className="big-unit"> hPa</span></div>
              <div className="card-sub">
                {weather.main.pressure > 1013 ? "High pressure system" : "Low pressure system"}
              </div>
            </div>

            <div className="card vis-card">
              <div className="card-label">Visibility</div>
              <div className="big-value">{(weather.visibility / 1000).toFixed(1)}<span className="big-unit"> km</span></div>
              <div className="card-sub">
                {weather.visibility >= 10000 ? "Clear and unrestricted"
                  : weather.visibility >= 5000 ? "Moderate visibility"
                  : "Reduced visibility"}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}