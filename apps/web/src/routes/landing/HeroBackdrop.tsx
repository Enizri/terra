import { useEffect, useRef } from "react";

/** Grainy star-masked gradient wash behind the hero. */
const COL_1 = [232, 64, 13];
const COL_2 = [255, 238, 216];
const COL_3 = [208, 178, 255];
const BG = "#e8400d";

const VERTEX = `
attribute vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const FRAGMENT = `
#ifdef GL_ES
precision highp float;
#endif

uniform vec2 u_resolution;
uniform float u_time;
uniform vec2 u_mouse;
uniform float u_dpr;
uniform vec3 u_col1;
uniform vec3 u_col2;
uniform vec3 u_col3;

/* Grain. Divided by dpr so a retina screen gets the same perceived noise. */
float rand(vec2 co) {
  return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453) / u_dpr;
}

vec4 circle(vec2 st, vec2 center, float radius, float blur, vec3 col) {
  float dist = distance(st, center) * 2.0;
  vec4 f_col = vec4(1.0 - smoothstep(radius, radius + blur, dist));
  f_col.rgb *= col;
  return f_col;
}

void main() {
  vec2 fst = gl_FragCoord.xy / u_resolution.xy;
  float aspect = u_resolution.x / u_resolution.y;
  vec2 mst = fst;
  vec2 m = u_mouse.xy / u_resolution.xy;

  vec3 col1 = u_col1 / 255.0;
  vec3 col2 = u_col2 / 255.0;
  vec3 col3 = u_col3 / 255.0;

  vec4 color = vec4(0.0);

  /* Circle 1 follows the pointer, the other two drift on their own clocks. */
  vec2 aC = vec2(m.x, 1.0 - m.y);
  float aR = 0.75;
  float aB = 0.75;

  vec2 bC = vec2(
    0.5 + sin(u_time * 0.4) * 0.5 * cos(u_time * 0.2) * 0.5,
    0.5 + sin(u_time * 0.3) * 0.5 * cos(u_time * 0.5) * 0.5
  );
  float bR = 1.0;
  float bB = 1.0;

  vec2 cC = vec2(
    (0.5 + cos(u_time * 0.5) * 0.5 * sin(u_time * 0.2) * 0.5) * aspect,
    0.5 + cos(u_time * 0.4) * 0.5 * sin(u_time * 0.3) * 0.5
  );
  float cR = 1.0;
  float cB = 1.0;

  /* Pointer-weighted domain warp: the wash ripples where the cursor is. */
  mst.x += cos(u_time * 0.37 + mst.x * 15.0) * 0.21
         * sin(u_time * 0.14 + mst.y * 7.0) * 0.29 * (m.x - 0.5) * 12.0;
  mst.y += sin(u_time * 0.15 + mst.x * 13.0) * 0.37
         * cos(u_time * 0.36 + mst.y * 5.0) * 0.12 * (m.y - 0.5) * 12.0;

  vec4 b = circle(mst, bC, bR, bB, vec3(1.0));
  vec4 c = circle(mst, cC, cR, cB, vec3(1.0));
  vec4 a = circle(mst, aC, aR, aB, vec3(1.0));

  /* Subtractive blend: each field is carved out by its neighbour, which is
     what gives the banded edges instead of a plain additive smear. */
  vec4 field1 = b - b * c;
  vec4 field2 = b - b * a;
  field1 -= field1 * field2;
  field2 -= field1 * field2;

  vec4 tinted1 = field1;
  tinted1.rgb *= col1;
  vec4 tinted2 = field2;
  tinted2.rgb *= col3;
  color += tinted1;
  color += tinted2;

  vec4 field3 = c - c * b;
  field3 -= field1 * field2;
  field3.rgb *= col2;
  color += field3;

  color += circle(mst, bC, bR, bB, col2) * (field1 - b) * (field2 - b);

  float noise = rand(fst * 10.0) * 0.2;
  color.rgb *= 1.0 - vec3(noise);

  gl_FragColor = color;
}
`;

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn(gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

/** Idle ambient drift ~15fps. */
const IDLE_FRAME_MS = 66;
/** Full-rate while the pointer is actively moving / catching up. */
const ACTIVE_FRAME_MS = 0;
/** Treat the pointer lerp as settled once delta is below this (device px). */
const SETTLE_PX = 0.35;

export default function HeroBackdrop() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    const gl = canvas.getContext("webgl", {
      antialias: false,
      alpha: true,
      powerPreference: "low-power",
      preserveDrawingBuffer: true,
    });
    // No WebGL: orange CSS bg still shows through the star mask — fine floor.
    if (!gl) return;

    const vs = compile(gl, gl.VERTEX_SHADER, VERTEX);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    if (!vs || !fs) return;
    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn(gl.getProgramInfoLog(program));
      return;
    }

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const aPosition = gl.getAttribLocation(program, "aPosition");
    const uResolution = gl.getUniformLocation(program, "u_resolution");
    const uTime = gl.getUniformLocation(program, "u_time");
    const uMouse = gl.getUniformLocation(program, "u_mouse");
    const uDpr = gl.getUniformLocation(program, "u_dpr");
    const uCol1 = gl.getUniformLocation(program, "u_col1");
    const uCol2 = gl.getUniformLocation(program, "u_col2");
    const uCol3 = gl.getUniformLocation(program, "u_col3");

    // Cap hard — hero grain doesn't need retina fill-rate.
    const dpr = Math.min(window.devicePixelRatio || 1, 1);
    const target = { x: 0, y: 0 };
    const pointer = { x: 0, y: 0 };
    let width = 0;
    let height = 0;
    let touched = false;
    // Starts hidden behind the hero; the reveal class flips it on.
    let visible = false;
    let frame: number | null = null;
    let lastDraw = 0;
    let lastMove = 0;

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const start = Date.now();

    const resize = () => {
      const w = Math.round(canvas.clientWidth * dpr);
      const h = Math.round(canvas.clientHeight * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      width = canvas.width;
      height = canvas.height;
      // Parks the pointer field at canvas centre until first move.
      if (!touched) {
        target.x = pointer.x = width / 2;
        target.y = pointer.y = height / 2;
      }
    };

    const draw = (time: number) => {
      gl.viewport(0, 0, width, height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.enableVertexAttribArray(aPosition);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);
      gl.uniform2fv(uResolution, [width, height]);
      gl.uniform1f(uTime, time);
      gl.uniform2fv(uMouse, [pointer.x, pointer.y]);
      gl.uniform1f(uDpr, dpr);
      gl.uniform3fv(uCol1, COL_1);
      gl.uniform3fv(uCol2, COL_2);
      gl.uniform3fv(uCol3, COL_3);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    };

    const stopLoop = () => {
      if (frame !== null) {
        cancelAnimationFrame(frame);
        frame = null;
      }
    };

    const tick = (now: number) => {
      frame = null;
      if (!visible || document.hidden || still) return;

      pointer.x += (target.x - pointer.x) * 0.025;
      pointer.y += (target.y - pointer.y) * 0.025;

      const dx = target.x - pointer.x;
      const dy = target.y - pointer.y;
      const settling = dx * dx + dy * dy >= SETTLE_PX * SETTLE_PX;
      const pointerHot = settling || now - lastMove < 160;
      const minGap = pointerHot ? ACTIVE_FRAME_MS : IDLE_FRAME_MS;

      if (now - lastDraw >= minGap) {
        lastDraw = now;
        // Keep u_time advancing so the wash keeps drifting (wash motion).
        draw(0.0025 * (Date.now() - start));
      }

      frame = requestAnimationFrame(tick);
    };

    const kick = () => {
      if (!visible || document.hidden || still || frame !== null) return;
      frame = requestAnimationFrame(tick);
    };

    const paintOnce = () => {
      resize();
      draw(still ? 0 : 0.0025 * (Date.now() - start));
    };

    paintOnce();

    if (still) {
      const onResize = () => paintOnce();
      window.addEventListener("resize", onResize);
      return () => window.removeEventListener("resize", onResize);
    }

    const onPointerMove = (e: MouseEvent) => {
      if (!visible || document.hidden) return;
      const rect = canvas.getBoundingClientRect();
      target.x = (e.clientX - rect.left) * dpr;
      target.y = (e.clientY - rect.top) * dpr;
      touched = true;
      lastMove = performance.now();
      kick();
    };

    const onResize = () => {
      paintOnce();
      kick();
    };

    const onVisibility = () => {
      if (document.hidden) {
        stopLoop();
      } else if (visible) {
        paintOnce();
        kick();
      }
    };

    window.addEventListener("mousemove", onPointerMove, { passive: true });
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVisibility);

    // The wrap is fixed and viewport-sized, so it always "intersects" —
    // observing it would keep the shader drawing for the whole page. What
    // actually matters is whether the star itself is shown (it is hidden behind
    // the hero), which the section tracker signals with a class.
    const star = wrap.firstElementChild as HTMLElement;
    const shown = () => star.classList.contains("sh-backdrop--revealed");
    const syncVisible = () => {
      const next = shown();
      if (next === visible) return;
      visible = next;
      if (!visible) {
        stopLoop();
        canvas.style.visibility = "hidden";
      } else {
        canvas.style.visibility = "visible";
        paintOnce();
        kick();
      }
    };
    visible = shown();
    canvas.style.visibility = visible ? "visible" : "hidden";
    const observer = new MutationObserver(syncVisible);
    observer.observe(star, { attributes: true, attributeFilter: ["class"] });

    kick();

    return () => {
      observer.disconnect();
      window.removeEventListener("mousemove", onPointerMove);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
      stopLoop();
    };
  }, []);

  return (
    <div ref={wrapRef} className="sh-backdrop-wrap" aria-hidden>
      <div className="sh-backdrop">
        {/* Spin is a pure-CSS compositor animation on this child (terra.css). */}
        <div className="sh-backdrop__spin" style={{ backgroundColor: BG }}>
          <canvas ref={canvasRef} className="sh-backdrop-canvas" />
        </div>
      </div>
    </div>
  );
}
