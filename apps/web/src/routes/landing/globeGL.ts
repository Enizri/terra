import { CHARSET } from "./glyphGrid.ts";
import { INSTANCE_FLOATS, MAX_INSTANCES } from "./globeLayout.ts";

/* The GPU side of the hero globe. Canvas 2D drew one textured quad per glyph
   with a drawImage each, which at ~2000 cells a frame is thousands of driver
   calls a second — that overhead, not the pixels, was the cost. Here every
   glyph is one instance of a single quad, so a frame is one draw call.

   Deliberately hand-rolled: no GL library, nothing fetched at runtime. */

/** Font size the atlas is baked at. Tiles are drawn much smaller, so this is
 *  a supersample — mipmaps take it down cleanly. */
const ATLAS_FONT_PX = 32;
/** Square tile, big enough for the font's descenders and side bearings. */
const ATLAS_TILE = 48;
/** Quad side per unit of font size, from the tile's own proportions. */
const QUAD_SCALE = ATLAS_TILE / ATLAS_FONT_PX;
const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

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

export type GlobeRenderer = {
  /** Instance data is written straight into this, then handed to the GPU. */
  readonly data: Float32Array;
  /** Re-bakes the tiles. The atlas is rasterised once at mount, so if the
   *  webfont lands after that the globe would keep the fallback glyphs (or
   *  nothing) forever — there is no per-frame redraw to correct it. */
  refreshAtlas: () => void;
  resize: (cssSize: number, dpr: number) => void;
  render: (count: number) => void;
  dispose: () => void;
};

/** Sets up the single-draw-call renderer, or returns null if WebGL2 is out.
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

  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  const program = vs && fs ? gl.createProgram() : null;
  if (!vs || !fs || !program) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  // One unit quad, reused by every glyph.
  const cornerBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuf);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5]),
    gl.STATIC_DRAW,
  );
  const aCorner = gl.getAttribLocation(program, "a_corner");
  gl.enableVertexAttribArray(aCorner);
  gl.vertexAttribPointer(aCorner, 2, gl.FLOAT, false, 0, 0);

  const data = new Float32Array(MAX_INSTANCES * INSTANCE_FLOATS);
  const instanceBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuf);
  gl.bufferData(gl.ARRAY_BUFFER, data.byteLength, gl.DYNAMIC_DRAW);

  const stride = INSTANCE_FLOATS * 4;
  const attrib = (name: string, size: number, offset: number) => {
    const loc = gl.getAttribLocation(program, name);
    if (loc < 0) return;
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset);
    gl.vertexAttribDivisor(loc, 1);
  };
  attrib("a_offset", 2, 0);
  attrib("a_size", 1, 8);
  attrib("a_tile", 1, 12);
  attrib("a_color", 4, 16);

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

  gl.useProgram(program);
  gl.uniform1f(gl.getUniformLocation(program, "u_tiles"), CHARSET.length);
  gl.uniform1i(gl.getUniformLocation(program, "u_atlas"), 0);
  const uRes = gl.getUniformLocation(program, "u_res");

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  return {
    data,
    refreshAtlas: uploadAtlas,
    resize(cssSize, dpr) {
      // Density is already capped in layout. Bound fill-rate so a retina
      // 680px orb does not become a 2k framebuffer.
      const px = Math.max(1, Math.min(900, Math.round(cssSize * Math.min(dpr, 1.5))));
      if (canvas.width !== px || canvas.height !== px) {
        canvas.width = px;
        canvas.height = px;
      }
      gl.useProgram(program);
      gl.viewport(0, 0, px, px);
      gl.uniform2f(uRes, cssSize, cssSize);
    },
    render(count) {
      gl.bindVertexArray(vao);
      gl.useProgram(program);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (count <= 0) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, count * INSTANCE_FLOATS);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    },
    dispose() {
      // Do not loseContext(): React Strict Mode remounts on the same canvas,
      // and a lost context cannot be recovered — the orb would stay blank.
      gl.deleteProgram(program);
      gl.deleteBuffer(cornerBuf);
      gl.deleteBuffer(instanceBuf);
      gl.deleteVertexArray(vao);
      gl.deleteTexture(texture);
    },
  };
}
