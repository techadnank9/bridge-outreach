import { useEffect, useRef } from "react";

// A quiet, living picture of a network: points in the four lead colours drift and link when close.
// Plain canvas, no outside scripts; it pauses when the tab is hidden and holds still for reduced motion.
const COLORS = ["#7ea6ff", "#c49bff", "#f2b45a", "#5fd0c5"];

export function NetworkField({ count = 70, linkDistance = 130 }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas.getContext("2d");
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0, h = 0, raf = 0, nodes = [];
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const r = canvas.getBoundingClientRect();
      w = r.width; h = r.height;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!nodes.length) {
        nodes = Array.from({ length: count }, (_, i) => ({
          x: Math.random() * w, y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.25, vy: (Math.random() - 0.5) * 0.25,
          r: 1.2 + Math.random() * 1.8, c: COLORS[i % COLORS.length],
        }));
      }
    };
    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      for (const n of nodes) {
        if (!still) {
          n.x += n.vx; n.y += n.vy;
          if (n.x < 0 || n.x > w) n.vx *= -1;
          if (n.y < 0 || n.y > h) n.vy *= -1;
        }
      }
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < linkDistance) {
            ctx.strokeStyle = `rgba(150, 175, 230, ${0.22 * (1 - d / linkDistance)})`;
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          }
        }
      }
      for (const n of nodes) {
        ctx.fillStyle = n.c;
        ctx.shadowColor = n.c; ctx.shadowBlur = 8;
        ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.shadowBlur = 0;
      if (!still) raf = requestAnimationFrame(draw);
    };
    const onVisibility = () => { cancelAnimationFrame(raf); if (!document.hidden) raf = requestAnimationFrame(draw); };
    const ro = new ResizeObserver(() => { resize(); if (still) draw(); });
    ro.observe(canvas);
    resize(); raf = requestAnimationFrame(draw);
    document.addEventListener("visibilitychange", onVisibility);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); document.removeEventListener("visibilitychange", onVisibility); };
  }, [count, linkDistance]);
  return <canvas ref={ref} style={{ width: "100%", height: "100%", display: "block" }} aria-hidden="true" />;
}
