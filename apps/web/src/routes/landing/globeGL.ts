import { CHARSET } from "./glyphGrid.ts";
import { MAX_LABELS, MAX_SOLID, SOLID_FLOATS } from "./globeInterior.ts";
import { INSTANCE_FLOATS, MAX_INSTANCES } from "./globeLayout.ts";

/* The GPU side of the hero globe. Canvas 2D drew one textured quad per glyph
   with a drawImage each, which at ~2000 cells a frame is thousands of driver
   calls a second — that overhead, not the pixels, was the cost. Here every
   glyph is one instance of a single quad, so a frame is one draw call.

   An optional second pass draws the interior architecture map (solid cards /
   wires + label glyphs) under the shell. Glyph shaders and atlas are unchanged.

   Deliberately hand-rolled: no GL library, nothing fetched at runtime. */

/** Font size the atlas is baked at. Tiles are drawn much smaller, so this is
 *  a supersample — mipmaps take it down cleanly. */
const ATLAS_FONT_PX = 32;
/** Square tile, big enough for the font's descenders and side bearings. */
const ATLAS_TILE = 48;
/** Quad side per unit of font size, from the tile's own proportions. */
const QUAD_SCALE = ATLAS_TILE / ATLAS_FONT_PX;
const MONO = '"Geist Mono Variable", ui-monospace, SFMono-Regular, Menlo, monospace';

const VERT = `#version 300 es
in vec2 a_corner;
in vec2 a_offset;
in float a_size;
in float a_tile;
in vec4 a_color;
uniform vec2 u_res;
uniform float u_tiles;
out vec2 v_uv;
out vec4 v_color;
void main() {
  vec2 px = a_offset + a_corner * a_size * ${QUAD_SCALE.toFixed(4)};
  vec2 clip = (px / u_res) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_uv = vec2((a_tile + a_corner.x + 0.5) / u_tiles, a_corner.y + 0.5);
  v_color = a_color;
}`;

const FRAG = `#version 300 es
precision mediump float;
in vec2 v_uv;
in vec4 v_color;
uniform sampler2D u_atlas;
out vec4 outColor;
void main() {
  // The atlas holds coverage in alpha; colour comes per instance.
  float mask = texture(u_atlas, v_uv).a;
  outColor = vec4(v_color.rgb, v_color.a * mask);
}`;

const SOLID_VERT = `#version 300 es
in vec2 a_corner;
in vec2 a_offset;
in vec2 a_half;
in vec2 a_rot;
in vec4 a_color;
uniform vec2 u_res;
out vec4 v_color;
void main() {
  vec2 local = a_corner * a_half;
  vec2 rot = vec2(
    local.x * a_rot.x - local.y * a_rot.y,
    local.x * a_rot.y + local.y * a_rot.x
  );
  vec2 px = a_offset + rot;
  vec2 clip = (px / u_res) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_color = a_color;
}`;

const SOLID_FRAG = `#version 300 es
precision mediump float;
in vec4 v_color;
out vec4 outColor;
void main() {
  outColor = v_color;
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function link(gl: WebGL2RenderingContext, vsSrc: string, fsSrc: string) {
  const vs = compile(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc);
  const program = vs && fs ? gl.createProgram() : null;
  if (!vs || !fs || !program) {
    if (vs) gl.deleteShader(vs);
    if (fs) gl.deleteShader(fs);
    return null;
  }
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

/** One strip of white glyphs on transparent, one tile per charset entry. */
function atlasCanvas() {
  const canvas = document.createElement("canvas");
  canvas.width = ATLAS_TILE * CHARSET.length;
  canvas.height = ATLAS_TILE;
  const g = canvas.getContext("2d");
  if (g) {
    g.font = `400 ${ATLAS_FONT_PX}px ${MONO}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = "#fff";
    for (let i = 0; i < CHARSET.length; i++) {
      g.fillText(CHARSET[i], i * ATLAS_TILE + ATLAS_TILE / 2, ATLAS_TILE / 2);
    }
  }
  return canvas;
}

export type GlobeRenderCounts = {
  glyphs: number;
  solids?: number;
  labels?: number;
};

export type GlobeRenderer = {
  /** Glyph shell instances — written by layoutGlobe. */
  readonly data: Float32Array;
  /** Interior solid quads — written by layoutInterior. */
  readonly solidData: Float32Array;
  /** Interior label glyphs — written by layoutInterior. */
  readonly labelData: Float32Array;
  /** Re-bakes the tiles. The atlas is rasterised once at mount, so if the
   *  webfont lands after that the globe would keep the fallback glyphs (or
   *  nothing) forever — there is no per-frame redraw to correct it. */
  refreshAtlas: () => void;
  resize: (cssW: number, cssH: number, dpr: number) => void;
  /** Clear, then interior (optional) then glyph shell. */
  render: (counts: GlobeRenderCounts | number) => void;
  dispose: () => void;
};

/** Sets up the renderer, or returns null if WebGL2 is out.
 *  `"lost"` means this canvas already had a WebGL context that was killed —
 *  the caller should mount a fresh canvas. */
export function createGlobeRenderer(
  canvas: HTMLCanvasElement,
): GlobeRenderer | "lost" | null {
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    antialias: false,
    depth: false,
    premultipliedAlpha: false,
    desynchronized: true,
    powerPreference: "high-performance",
  });
  if (!gl) return null;
  if (gl.isContextLost()) return "lost";

  const glyphProg = link(gl, VERT, FRAG);
  const solidProg = link(gl, SOLID_VERT, SOLID_FRAG);
  if (!glyphProg || !solidProg) {
    if (glyphProg) gl.deleteProgram(glyphProg);
    if (solidProg) gl.deleteProgram(solidProg);
    return null;
  }

  const cornerBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuf);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5]),
    gl.STATIC_DRAW,
  );

  const data = new Float32Array(MAX_INSTANCES * INSTANCE_FLOATS);
  const solidData = new Float32Array(MAX_SOLID * SOLID_FLOATS);
  const labelData = new Float32Array(MAX_LABELS * INSTANCE_FLOATS);

  const glyphVao = gl.createVertexArray();
  const glyphInstanceBuf = gl.createBuffer();
  {
    gl.bindVertexArray(glyphVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuf);
    const aCorner = gl.getAttribLocation(glyphProg, "a_corner");
    gl.enableVertexAttribArray(aCorner);
    gl.vertexAttribPointer(aCorner, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, glyphInstanceBuf);
    gl.bufferData(gl.ARRAY_BUFFER, Math.max(data.byteLength, labelData.byteLength), gl.DYNAMIC_DRAW);
    const stride = INSTANCE_FLOATS * 4;
    const attrib = (name: string, size: number, offset: number) => {
      const loc = gl.getAttribLocation(glyphProg, name);
      if (loc < 0) return;
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset);
      gl.vertexAttribDivisor(loc, 1);
    };
    attrib("a_offset", 2, 0);
    attrib("a_size", 1, 8);
    attrib("a_tile", 1, 12);
    attrib("a_color", 4, 16);
  }

  const solidVao = gl.createVertexArray();
  const solidInstanceBuf = gl.createBuffer();
  {
    gl.bindVertexArray(solidVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuf);
    const aCorner = gl.getAttribLocation(solidProg, "a_corner");
    gl.enableVertexAttribArray(aCorner);
    gl.vertexAttribPointer(aCorner, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, solidInstanceBuf);
    gl.bufferData(gl.ARRAY_BUFFER, solidData.byteLength, gl.DYNAMIC_DRAW);
    const stride = SOLID_FLOATS * 4;
    const attrib = (name: string, size: number, offset: number) => {
      const loc = gl.getAttribLocation(solidProg, name);
      if (loc < 0) return;
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset);
      gl.vertexAttribDivisor(loc, 1);
    };
    attrib("a_offset", 2, 0);
    attrib("a_half", 2, 8);
    attrib("a_rot", 2, 16);
    attrib("a_color", 4, 24);
  }

  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  const uploadAtlas = () => {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlasCanvas());
    gl.generateMipmap(gl.TEXTURE_2D);
  };
  uploadAtlas();
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  gl.useProgram(glyphProg);
  gl.uniform1f(gl.getUniformLocation(glyphProg, "u_tiles"), CHARSET.length);
  gl.uniform1i(gl.getUniformLocation(glyphProg, "u_atlas"), 0);
  const uGlyphRes = gl.getUniformLocation(glyphProg, "u_res");
  const uSolidRes = gl.getUniformLocation(solidProg, "u_res");

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.bindVertexArray(null);

  const drawGlyphs = (buf: Float32Array, count: number) => {
    if (count <= 0) return;
    gl.bindVertexArray(glyphVao);
    gl.useProgram(glyphProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.bindBuffer(gl.ARRAY_BUFFER, glyphInstanceBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, buf, 0, count * INSTANCE_FLOATS);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
  };

  return {
    data,
    solidData,
    labelData,
    refreshAtlas: uploadAtlas,
    resize(cssW, cssH, dpr) {
      const scale = Math.min(dpr, 1.5);
      let pxW = Math.max(1, Math.round(cssW * scale));
      let pxH = Math.max(1, Math.round(cssH * scale));
      const cap = 1200;
      const m = Math.max(pxW, pxH);
      if (m > cap) {
        const k = cap / m;
        pxW = Math.max(1, Math.round(pxW * k));
        pxH = Math.max(1, Math.round(pxH * k));
      }
      if (canvas.width !== pxW || canvas.height !== pxH) {
        canvas.width = pxW;
        canvas.height = pxH;
      }
      gl.viewport(0, 0, pxW, pxH);
      gl.useProgram(glyphProg);
      gl.uniform2f(uGlyphRes, cssW, cssH);
      gl.useProgram(solidProg);
      gl.uniform2f(uSolidRes, cssW, cssH);
    },
    render(counts) {
      const c = typeof counts === "number" ? { glyphs: counts } : counts;
      const solids = c.solids ?? 0;
      const labels = c.labels ?? 0;
      const glyphs = c.glyphs;

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      if (solids > 0) {
        gl.bindVertexArray(solidVao);
        gl.useProgram(solidProg);
        gl.bindBuffer(gl.ARRAY_BUFFER, solidInstanceBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, solidData, 0, solids * SOLID_FLOATS);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, solids);
      }

      drawGlyphs(labelData, labels);
      drawGlyphs(data, glyphs);
      gl.bindVertexArray(null);
    },
    dispose() {
      gl.deleteProgram(glyphProg);
      gl.deleteProgram(solidProg);
      gl.deleteBuffer(cornerBuf);
      gl.deleteBuffer(glyphInstanceBuf);
      gl.deleteBuffer(solidInstanceBuf);
      gl.deleteVertexArray(glyphVao);
      gl.deleteVertexArray(solidVao);
      gl.deleteTexture(texture);
    },
  };
}
