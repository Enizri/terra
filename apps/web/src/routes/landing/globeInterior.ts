import { diagramEdges, diagramNodes, type DiagramKind, type DiagramNode } from "./data.ts";
import { CHAR_INDEX, hoverWeight } from "./glyphGrid.ts";
import { INSTANCE_FLOATS } from "./globeLayout.ts";

/* Flat Terra architecture billboard inside the glyph hole — same 3-column
   flow, orthogonal wires, and relationship labels as the workspace map. */

/** Must match globeLayout — do not drift. */
const TILT = (10 * Math.PI) / 180;
const CAM_Z = 4;
const SPHERE_FILL = 0.9;
/** Billboard fits inside the glyph shell. */
const INTERIOR_FILL = 0.58;
/** Flashlight selects the active card; map stays readable with the hole open. */
const FLASH_R = 0.72;
/** Billboard tracks the globe softer than the shell so cards stay legible. */
const LOOK_DAMP = 0.45;
/** Slight push toward the camera so the map sits in the hole. */
const Z_PLANE = 0.12;

/** Solid floats: x, y, halfW, halfH, cos, sin, r, g, b, a. */
export const SOLID_FLOATS = 10;
/** Card size in local px at persp 1 — readable through the hole. */
const CARD_W = 90;
const CARD_H = 42;
const COL_GAP = 28;
const ROW_GAP = 12;
const ARROW_GAP = 5;
const DETOUR = 11;
const WIRE_W = 1.65;
const WIRE_LIT_W = 2.6;
const ARROW_LEN = 7;
const ARROW_HALF = 3.2;
const TITLE_PX = 11;
const HINT_PX = 7;
const PURPOSE_PX = 6.5;
const EDGE_LABEL_PX = 6.5;
const CULL = 0.02;
const DIM = 0.28;

/** Workspace diagram palette (#1c1e24 cards, light text, soft border). */
const KIND_TINT: Record<DiagramKind, readonly [number, number, number]> = {
  frontend: [0.55, 0.72, 1],
  backend: [0.95, 0.7, 0.42],
  service: [0.55, 0.85, 0.62],
  data: [0.78, 0.62, 0.95],
};
const CARD_FILL = [0.11, 0.118, 0.141] as const; // #1c1e24
const CARD_BORDER = [0.55, 0.55, 0.58] as const;
const WIRE_RGB = [0.78, 0.78, 0.82] as const;
const WIRE_LIT = [0.55, 0.78, 1] as const;
const TITLE_RGB = [0.92, 0.92, 0.94] as const;
const HINT_RGB = [0.55, 0.55, 0.58] as const;
const PURPOSE_RGB = [0.62, 0.62, 0.66] as const;
const PILL_FILL = [0.11, 0.118, 0.141] as const;
const PILL_BORDER = [0.4, 0.4, 0.44] as const;

/** Cards (fill+border+bar+hairline) + polylines + arrowheads + ticks + pills. */
export const MAX_SOLID = 6 * 8 + diagramEdges.length * 14 + 24;
export const MAX_LABELS = 420;

export type InteriorFrame = {
  size: number;
  width?: number;
  height?: number;
  pointerX: number;
  pointerY: number;
  yaw: number;
  pitch: number;
  presence: number;
  t: number;
  reduced: boolean;
};

export type InteriorLayout = {
  solids: number;
  labels: number;
  nodes: { id: string; sx: number; sy: number; alpha: number }[];
};

export type Pt2 = { x: number; y: number };
export type Box2 = { x: number; y: number; w: number; h: number };

type Vec3 = { x: number; y: number; z: number };

function project(
  x0: number,
  y0: number,
  z0: number,
  cx: number,
  cy: number,
  R: number,
  yaw: number,
  pitch: number,
) {
  const cosY = Math.cos(yaw);
  const sinY = Math.sin(yaw);
  let x = x0 * cosY - z0 * sinY;
  let z = x0 * sinY + z0 * cosY;
  let y = y0;

  const cosP = Math.cos(pitch);
  const sinP = Math.sin(pitch);
  const zp = z * cosP - y * sinP;
  y = z * sinP + y * cosP;
  z = zp;

  const cosT = Math.cos(TILT);
  const sinT = Math.sin(TILT);
  const xr = x * cosT - y * sinT;
  y = x * sinT + y * cosT;
  x = xr;

  const persp = CAM_Z / (CAM_Z - z / R);
  return {
    sx: cx + x * persp,
    sy: cy + y * persp,
    persp,
    depth: (z / R + 1) / 2,
  };
}

/** Pack diagram nodes into a left→right 3-column flow on the billboard plane. */
export function flowBoxes(scale: number): Map<string, Box2> {
  const w = CARD_W * scale;
  const h = CARD_H * scale;
  const colGap = COL_GAP * scale;
  const rowGap = ROW_GAP * scale;
  const byCol = new Map<number, DiagramNode[]>();
  for (const n of diagramNodes) {
    const list = byCol.get(n.col) ?? [];
    list.push(n);
    byCol.set(n.col, list);
  }
  for (const list of byCol.values()) list.sort((a, b) => a.row - b.row);

  const colXs = [-1, 0, 1].map((c) => c * (w + colGap));
  const boxes = new Map<string, Box2>();

  const backend = byCol.get(1) ?? [];
  const stackH = backend.length * h + Math.max(0, backend.length - 1) * rowGap;
  const stackTop = -stackH / 2;

  for (let i = 0; i < backend.length; i++) {
    const n = backend[i];
    boxes.set(n.id, {
      x: colXs[1] - w / 2,
      y: stackTop + i * (h + rowGap),
      w,
      h,
    });
  }

  const entry = byCol.get(0) ?? [];
  for (const n of entry) {
    boxes.set(n.id, {
      x: colXs[0] - w / 2,
      y: -h / 2,
      w,
      h,
    });
  }

  const store = byCol.get(2) ?? [];
  const memos = boxes.get("memos");
  const files = boxes.get("files");
  const storeY =
    memos && files ? (memos.y + files.y + files.h) / 2 - h / 2 : -h / 2;
  for (const n of store) {
    boxes.set(n.id, {
      x: colXs[2] - w / 2,
      y: storeY,
      w,
      h,
    });
  }

  return boxes;
}

/** Orthogonal edge router (column hop, neighbour, or same-column detour). */
export function routeOrtho(
  a: Pick<DiagramNode, "col" | "row">,
  b: Pick<DiagramNode, "col" | "row">,
  ra: Box2,
  rb: Box2,
  scale = 1,
): { pts: Pt2[]; mid: Pt2 } | null {
  if (!ra.w || !ra.h || !rb.w || !rb.h) return null;

  const gap = ARROW_GAP * scale;
  const detour = DETOUR * scale;
  const ay = ra.y + ra.h / 2;
  const by = rb.y + rb.h / 2;
  let pts: Pt2[];

  if (a.col !== b.col) {
    const x1 = ra.x + ra.w;
    const x2 = rb.x - gap;
    pts =
      Math.abs(ay - by) < 4 * scale
        ? [
            { x: x1, y: ay },
            { x: x2, y: ay },
          ]
        : (() => {
            const mx = (ra.x + ra.w + rb.x) / 2;
            return [
              { x: x1, y: ay },
              { x: mx, y: ay },
              { x: mx, y: by },
              { x: x2, y: by },
            ];
          })();
  } else if (Math.abs(a.row - b.row) === 1) {
    const cx = ra.x + ra.w / 2;
    const down = b.row > a.row;
    pts = [
      { x: cx, y: down ? ra.y + ra.h : ra.y },
      { x: cx, y: down ? rb.y - gap : rb.y + rb.h + gap },
    ];
  } else {
    const dx = Math.min(ra.x, rb.x) - detour * Math.abs(a.row - b.row);
    pts = [
      { x: ra.x, y: ay },
      { x: dx, y: ay },
      { x: dx, y: by },
      { x: rb.x - gap, y: by },
    ];
  }

  let best = 0;
  let mid = pts[0];
  for (let i = 1; i < pts.length; i++) {
    const len = Math.abs(pts[i].x - pts[i - 1].x) + Math.abs(pts[i].y - pts[i - 1].y);
    if (len > best) {
      best = len;
      mid = {
        x: (pts[i].x + pts[i - 1].x) / 2,
        y: (pts[i].y + pts[i - 1].y) / 2,
      };
    }
  }

  return { pts, mid };
}

/** Billboard local position — center of a flow box, slightly in front of origin. */
export function nodeLocalPos(box: Box2, Ri: number): Vec3 {
  return {
    x: box.x + box.w / 2,
    y: box.y + box.h / 2,
    z: Ri * Z_PLANE,
  };
}

function writeSolid(
  out: Float32Array,
  i: number,
  sx: number,
  sy: number,
  halfW: number,
  halfH: number,
  angle: number,
  r: number,
  g: number,
  b: number,
  a: number,
) {
  const o = i * SOLID_FLOATS;
  out[o] = sx;
  out[o + 1] = sy;
  out[o + 2] = halfW;
  out[o + 3] = halfH;
  out[o + 4] = Math.cos(angle);
  out[o + 5] = Math.sin(angle);
  out[o + 6] = r;
  out[o + 7] = g;
  out[o + 8] = b;
  out[o + 9] = a;
}

function writeGlyph(
  out: Float32Array,
  i: number,
  sx: number,
  sy: number,
  size: number,
  tile: number,
  r: number,
  g: number,
  b: number,
  a: number,
) {
  const o = i * INSTANCE_FLOATS;
  out[o] = sx;
  out[o + 1] = sy;
  out[o + 2] = size;
  out[o + 3] = tile;
  out[o + 4] = r;
  out[o + 5] = g;
  out[o + 6] = b;
  out[o + 7] = a;
}

function writeText(
  labels: Float32Array,
  start: number,
  text: string,
  cx: number,
  cy: number,
  px: number,
  persp: number,
  r: number,
  g: number,
  b: number,
  a: number,
  max: number,
) {
  const glyphW = px * 0.58 * persp;
  const size = px * persp;
  let x = cx - (text.length * glyphW) / 2 + glyphW / 2;
  let n = start;
  for (const ch of text) {
    if (ch === " ") {
      x += glyphW;
      continue;
    }
    const tile = CHAR_INDEX.get(ch);
    if (tile === undefined || n >= max) {
      x += glyphW;
      continue;
    }
    writeGlyph(labels, n++, x, cy, size, tile, r, g, b, a);
    x += glyphW;
  }
  return n;
}

export function easeOutCubic(t: number) {
  const u = t <= 0 ? 0 : t >= 1 ? 1 : t;
  return 1 - (1 - u) ** 3;
}

function clipPurpose(s: string, max = 22) {
  if (s.length <= max) return s;
  return s.slice(0, max);
}

export function layoutInterior(
  f: InteriorFrame,
  solids: Float32Array,
  labels: Float32Array,
): InteriorLayout {
  const empty: InteriorLayout = { solids: 0, labels: 0, nodes: [] };
  if (f.reduced || f.presence <= 0.001) return empty;

  const paneW = f.width ?? f.size;
  const paneH = f.height ?? f.size;
  const cx = paneW / 2;
  const cy = paneH / 2;
  const R = (f.size / 2) * SPHERE_FILL;
  const Ri = R * INTERIOR_FILL;
  const flashR = R * FLASH_R;
  const presence = easeOutCubic(f.presence);
  const yaw = f.yaw * LOOK_DAMP;
  const pitch = f.pitch * LOOK_DAMP;
  const z0 = Ri * Z_PLANE;

  // Fit the 3-col pack inside the interior disc with a little margin.
  const packW = 3 * CARD_W + 2 * COL_GAP;
  const packH = 4 * CARD_H + 3 * ROW_GAP;
  const scale = Math.min((Ri * 1.55) / packW, (Ri * 1.7) / packH, 1.15);
  const enter = 0.94 + 0.06 * presence;
  const boxes = flowBoxes(scale);

  type Proj = { sx: number; sy: number; persp: number; depth: number; local: Vec3; box: Box2 };
  const projected = new Map<string, Proj>();
  const byId = Object.fromEntries(diagramNodes.map((n) => [n.id, n]));

  for (const node of diagramNodes) {
    const box = boxes.get(node.id);
    if (!box) continue;
    const local = nodeLocalPos(box, Ri);
    const p = project(local.x, local.y, local.z, cx, cy, R, yaw, pitch);
    projected.set(node.id, { ...p, local, box });
  }

  let solidN = 0;
  let labelN = 0;
  let nearestId = "";
  let nearestW = 0;

  const nodeMeta: InteriorLayout["nodes"] = [];
  for (const node of diagramNodes) {
    const p = projected.get(node.id)!;
    const w = hoverWeight(Math.hypot(p.sx - f.pointerX, p.sy - f.pointerY), flashR);
    nodeMeta.push({ id: node.id, sx: p.sx, sy: p.sy, alpha: 0 });
    if (w > nearestW) {
      nearestW = w;
      nearestId = node.id;
    }
  }

  const active = nearestId || diagramNodes[0]?.id || "";
  const linked = new Set<string>([active]);
  for (const e of diagramEdges) {
    if (e.from === active) linked.add(e.to);
    if (e.to === active) linked.add(e.from);
  }

  for (const meta of nodeMeta) {
    const p = projected.get(meta.id)!;
    const depthFade = 0.85 + 0.15 * p.depth;
    const linkMul = linked.has(meta.id) ? 1 : DIM;
    const hot = meta.id === active ? 1.08 : 1;
    meta.alpha = Math.min(1, presence * 0.92 * depthFade * linkMul * hot);
  }

  for (const edge of diagramEdges) {
    const from = byId[edge.from];
    const to = byId[edge.to];
    const pa = projected.get(edge.from);
    const pb = projected.get(edge.to);
    if (!from || !to || !pa || !pb) continue;

    const route = routeOrtho(from, to, pa.box, pb.box, scale);
    if (!route) continue;

    const lit = edge.from === active || edge.to === active;
    const edgeMul = lit ? 1 : DIM;
    const rgb = lit ? WIRE_LIT : WIRE_RGB;
    const wireHalf = ((lit ? WIRE_LIT_W : WIRE_W) / 2) * scale;

    for (let i = 0; i < route.pts.length - 1; i++) {
      const a = route.pts[i];
      const b = route.pts[i + 1];
      const p0 = project(a.x, a.y, z0, cx, cy, R, yaw, pitch);
      const p1 = project(b.x, b.y, z0, cx, cy, R, yaw, pitch);
      const dx = p1.sx - p0.sx;
      const dy = p1.sy - p0.sy;
      const len = Math.hypot(dx, dy);
      if (len < 0.5 || solidN >= MAX_SOLID) continue;
      const persp = (p0.persp + p1.persp) / 2;
      const depth = (p0.depth + p1.depth) / 2;
      const alpha = presence * edgeMul * (0.7 + 0.3 * depth);
      if (alpha < CULL) continue;
      writeSolid(
        solids,
        solidN++,
        (p0.sx + p1.sx) / 2,
        (p0.sy + p1.sy) / 2,
        (len / 2) * 1.02,
        wireHalf * persp,
        Math.atan2(dy, dx),
        rgb[0],
        rgb[1],
        rgb[2],
        alpha,
      );
    }

    // Arrowhead at destination.
    if (route.pts.length >= 2 && solidN + 2 <= MAX_SOLID) {
      const tip = route.pts[route.pts.length - 1];
      const prev = route.pts[route.pts.length - 2];
      const ang = Math.atan2(tip.y - prev.y, tip.x - prev.x);
      const tipP = project(tip.x, tip.y, z0, cx, cy, R, yaw, pitch);
      const alpha = presence * edgeMul * (0.75 + 0.25 * tipP.depth);
      if (alpha >= CULL) {
        const left = project(
          tip.x - Math.cos(ang) * ARROW_LEN * scale + Math.cos(ang + Math.PI / 2) * ARROW_HALF * scale,
          tip.y - Math.sin(ang) * ARROW_LEN * scale + Math.sin(ang + Math.PI / 2) * ARROW_HALF * scale,
          z0,
          cx,
          cy,
          R,
          yaw,
          pitch,
        );
        const right = project(
          tip.x - Math.cos(ang) * ARROW_LEN * scale + Math.cos(ang - Math.PI / 2) * ARROW_HALF * scale,
          tip.y - Math.sin(ang) * ARROW_LEN * scale + Math.sin(ang - Math.PI / 2) * ARROW_HALF * scale,
          z0,
          cx,
          cy,
          R,
          yaw,
          pitch,
        );
        for (const wingP of [left, right]) {
          const wdx = tipP.sx - wingP.sx;
          const wdy = tipP.sy - wingP.sy;
          const wlen = Math.hypot(wdx, wdy);
          if (wlen < 0.5 || solidN >= MAX_SOLID) continue;
          writeSolid(
            solids,
            solidN++,
            (tipP.sx + wingP.sx) / 2,
            (tipP.sy + wingP.sy) / 2,
            (wlen / 2) * 1.05,
            Math.max(0.7, ARROW_HALF * scale * tipP.persp * 0.35),
            Math.atan2(wdy, wdx),
            rgb[0],
            rgb[1],
            rgb[2],
            alpha,
          );
        }
      }
    }

    if (lit && solidN < MAX_SOLID) {
      const tickT = ((f.t * 0.55) % 1 + 1) % 1;
      // Walk polyline by arc length fraction.
      let total = 0;
      const segs: { a: Pt2; b: Pt2; len: number }[] = [];
      for (let i = 0; i < route.pts.length - 1; i++) {
        const a = route.pts[i];
        const b = route.pts[i + 1];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        segs.push({ a, b, len });
        total += len;
      }
      let walk = tickT * total;
      let tx = route.pts[0].x;
      let ty = route.pts[0].y;
      for (const s of segs) {
        if (walk <= s.len) {
          const u = s.len > 0 ? walk / s.len : 0;
          tx = s.a.x + (s.b.x - s.a.x) * u;
          ty = s.a.y + (s.b.y - s.a.y) * u;
          break;
        }
        walk -= s.len;
        tx = s.b.x;
        ty = s.b.y;
      }
      const p = project(tx, ty, z0, cx, cy, R, yaw, pitch);
      const alpha = presence * (0.7 + 0.3 * p.depth);
      if (alpha >= CULL) {
        writeSolid(solids, solidN++, p.sx, p.sy, 2.6 * p.persp, 2.6 * p.persp, 0, 1, 1, 1, alpha);
      }
    }

    if (edge.label && solidN + 5 <= MAX_SOLID) {
      const midP = project(route.mid.x, route.mid.y, z0, cx, cy, R, yaw, pitch);
      const alpha = presence * edgeMul * (0.8 + 0.2 * midP.depth);
      if (alpha >= CULL) {
        const pillW = (edge.label.length * EDGE_LABEL_PX * 0.58 * 0.5 + 6) * midP.persp * scale;
        const pillH = 7 * midP.persp * scale;
        writeSolid(
          solids,
          solidN++,
          midP.sx,
          midP.sy,
          pillW,
          pillH,
          0,
          PILL_FILL[0],
          PILL_FILL[1],
          PILL_FILL[2],
          alpha,
        );
        const t = Math.max(0.6, 0.9 * midP.persp);
        writeSolid(solids, solidN++, midP.sx, midP.sy - pillH, pillW, t / 2, 0, PILL_BORDER[0], PILL_BORDER[1], PILL_BORDER[2], alpha);
        writeSolid(solids, solidN++, midP.sx, midP.sy + pillH, pillW, t / 2, 0, PILL_BORDER[0], PILL_BORDER[1], PILL_BORDER[2], alpha);
        writeSolid(solids, solidN++, midP.sx - pillW, midP.sy, t / 2, pillH, 0, PILL_BORDER[0], PILL_BORDER[1], PILL_BORDER[2], alpha);
        writeSolid(solids, solidN++, midP.sx + pillW, midP.sy, t / 2, pillH, 0, PILL_BORDER[0], PILL_BORDER[1], PILL_BORDER[2], alpha);
        labelN = writeText(
          labels,
          labelN,
          edge.label,
          midP.sx,
          midP.sy,
          EDGE_LABEL_PX * scale,
          midP.persp,
          TITLE_RGB[0],
          TITLE_RGB[1],
          TITLE_RGB[2],
          alpha,
          MAX_LABELS,
        );
      }
    }
  }

  // Draw cards after wires so blocks sit on top.
  for (const node of diagramNodes) {
    const p = projected.get(node.id)!;
    const meta = nodeMeta.find((n) => n.id === node.id)!;
    const focus = node.id === active;
    const alpha = meta.alpha;
    if (alpha < CULL) continue;

    const stagger = 1 - node.col * 0.04;
    const grow = enter * stagger;
    const hw = (p.box.w / 2) * p.persp * grow;
    const hh = (p.box.h / 2) * p.persp * grow;
    const tint = KIND_TINT[node.kind];
    const border = focus ? tint : CARD_BORDER;

    if (solidN < MAX_SOLID) {
      writeSolid(
        solids,
        solidN++,
        p.sx,
        p.sy,
        hw,
        hh,
        0,
        CARD_FILL[0],
        CARD_FILL[1],
        CARD_FILL[2],
        alpha,
      );
    }
    if (solidN + 4 <= MAX_SOLID) {
      const t = Math.max(0.9, 1.15 * p.persp);
      writeSolid(solids, solidN++, p.sx, p.sy - hh, hw, t / 2, 0, border[0], border[1], border[2], alpha);
      writeSolid(solids, solidN++, p.sx, p.sy + hh, hw, t / 2, 0, border[0], border[1], border[2], alpha);
      writeSolid(solids, solidN++, p.sx - hw, p.sy, t / 2, hh, 0, border[0], border[1], border[2], alpha);
      writeSolid(solids, solidN++, p.sx + hw, p.sy, t / 2, hh, 0, border[0], border[1], border[2], alpha);
    }
    if (solidN < MAX_SOLID) {
      writeSolid(
        solids,
        solidN++,
        p.sx - hw + 1.8 * p.persp,
        p.sy,
        1.6 * p.persp,
        hh * 0.78,
        0,
        tint[0],
        tint[1],
        tint[2],
        alpha,
      );
    }

    const lines = focus ? 3 : 2;
    const titleY = p.sy - (lines === 3 ? 10 : 7) * p.persp * grow;
    const hintY = p.sy + (lines === 3 ? 12 : 8) * p.persp * grow;
    labelN = writeText(
      labels,
      labelN,
      node.label,
      p.sx + 3 * p.persp,
      titleY,
      TITLE_PX * scale * grow,
      p.persp,
      TITLE_RGB[0],
      TITLE_RGB[1],
      TITLE_RGB[2],
      alpha,
      MAX_LABELS,
    );

    if (focus && solidN < MAX_SOLID) {
      const purposeY = p.sy + 1 * p.persp * grow;
      labelN = writeText(
        labels,
        labelN,
        clipPurpose(node.purpose),
        p.sx + 3 * p.persp,
        purposeY,
        PURPOSE_PX * scale * grow,
        p.persp,
        PURPOSE_RGB[0],
        PURPOSE_RGB[1],
        PURPOSE_RGB[2],
        alpha * 0.9,
        MAX_LABELS,
      );
      // Hairline above the path hint.
      writeSolid(
        solids,
        solidN++,
        p.sx + 2 * p.persp,
        hintY - 5 * p.persp * grow,
        hw * 0.72,
        0.45 * p.persp,
        0,
        CARD_BORDER[0],
        CARD_BORDER[1],
        CARD_BORDER[2],
        alpha * 0.55,
      );
    }

    labelN = writeText(
      labels,
      labelN,
      node.hint,
      p.sx + 3 * p.persp,
      hintY,
      HINT_PX * scale * grow,
      p.persp,
      HINT_RGB[0],
      HINT_RGB[1],
      HINT_RGB[2],
      alpha * 0.95,
      MAX_LABELS,
    );
  }

  return { solids: solidN, labels: labelN, nodes: nodeMeta };
}

export function interiorInsideShell() {
  return INTERIOR_FILL < SPHERE_FILL;
}
