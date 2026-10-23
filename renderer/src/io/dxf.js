// DXF: leitura com dxf-parser (linhas, polilinhas, arcos, círculos, 3DFACE, blocos) e escrita ASCII R12.
import * as THREE from 'three';
import DxfParser from 'dxf-parser';
import { baseMaterial } from '../viewer.js';

// $INSUNITS → metros
const UNIT = { 0: 1, 1: 0.0254, 2: 0.3048, 4: 0.001, 5: 0.01, 6: 1, 7: 1000, 14: 0.1 };

export function importDxf(text, fileName, { unitOverride } = {}) {
  const dxf = new DxfParser().parseSync(text);
  const insUnits = dxf.header?.$INSUNITS;
  // Sem unidade declarada, desenhos de arquitetura costumam estar em milímetros
  const scale = unitOverride ?? (insUnits !== undefined && insUnits !== 0 ? (UNIT[insUnits] ?? 1) : 0.001);
  const layers = dxf.tables?.layer?.layers || {};
  const blocks = dxf.blocks || {};

  const byLayer = new Map();
  const bucket = layer => {
    if (!byLayer.has(layer)) byLayer.set(layer, { lines: [], lineColors: [], tris: [], triColors: [] });
    return byLayer.get(layer);
  };
  const colorOf = (e, inherited) => {
    const c = e.color ?? (e.colorIndex === 0 ? inherited : undefined) ?? layers[e.layer]?.color ?? inherited ?? 0xdddddd;
    return new THREE.Color(c === 0 ? 0xffffff : c);
  };

  const walk = (entities, matrix, inheritedColor, depth) => {
    if (depth > 8) return;
    const P = (p) => new THREE.Vector3(p.x || 0, p.y || 0, p.z || 0).applyMatrix4(matrix);
    for (const e of entities || []) {
      const b = bucket(e.layer || '0');
      const col = colorOf(e, inheritedColor);
      const seg = (a, c) => { b.lines.push(a, c); b.lineColors.push(col, col); };
      switch (e.type) {
        case 'LINE':
          if (e.vertices?.length >= 2) seg(P(e.vertices[0]), P(e.vertices[1]));
          break;
        case 'LWPOLYLINE':
        case 'POLYLINE': {
          const vs = (e.vertices || []).map(v => P({ x: v.x, y: v.y, z: v.z ?? e.elevation ?? 0 }));
          for (let i = 0; i + 1 < vs.length; i++) seg(vs[i], vs[i + 1]);
          if ((e.shape || e.closed) && vs.length > 2) seg(vs[vs.length - 1], vs[0]);
          break;
        }
        case 'CIRCLE':
        case 'ARC': {
          const a0 = e.type === 'CIRCLE' ? 0 : e.startAngle;
          let a1 = e.type === 'CIRCLE' ? Math.PI * 2 : e.endAngle;
          if (a1 < a0) a1 += Math.PI * 2;
          const n = Math.max(8, Math.ceil((a1 - a0) / (Math.PI / 24)));
          let prev = null;
          for (let i = 0; i <= n; i++) {
            const a = a0 + (a1 - a0) * i / n;
            const p = P({ x: e.center.x + e.radius * Math.cos(a), y: e.center.y + e.radius * Math.sin(a), z: e.center.z || 0 });
            if (prev) seg(prev, p);
            prev = p;
          }
          break;
        }
        case 'SPLINE': {
          const pts = (e.fitPoints?.length ? e.fitPoints : e.controlPoints || []).map(P);
          for (let i = 0; i + 1 < pts.length; i++) seg(pts[i], pts[i + 1]);
          break;
        }
        case '3DFACE': {
          const v = (e.vertices || []).map(P);
          if (v.length >= 3) {
            b.tris.push(v[0], v[1], v[2]); b.triColors.push(col, col, col);
            if (v.length === 4 && !v[3].equals(v[2])) { b.tris.push(v[0], v[2], v[3]); b.triColors.push(col, col, col); }
          }
          break;
        }
        case 'SOLID': {
          const v = (e.points || e.vertices || []).map(P);
          if (v.length >= 3) {
            b.tris.push(v[0], v[1], v[2]); b.triColors.push(col, col, col);
            if (v.length === 4) { b.tris.push(v[1], v[3], v[2]); b.triColors.push(col, col, col); }
          }
          break;
        }
        case 'INSERT': {
          const blk = blocks[e.name];
          if (!blk) break;
          const bp = blk.position || { x: 0, y: 0, z: 0 };
          const m = new THREE.Matrix4()
            .makeTranslation(e.position?.x || 0, e.position?.y || 0, e.position?.z || 0)
            .multiply(new THREE.Matrix4().makeRotationZ(THREE.MathUtils.degToRad(e.rotation || 0)))
            .multiply(new THREE.Matrix4().makeScale(e.xScale ?? 1, e.yScale ?? 1, e.zScale ?? 1))
            .multiply(new THREE.Matrix4().makeTranslation(-bp.x, -bp.y, -(bp.z || 0)));
          walk(blk.entities, matrix.clone().multiply(m), col.getHex(), depth + 1);
          break;
        }
        default: break; // TEXT, MTEXT, DIMENSION, HATCH… ficam de fora nesta versão
      }
    }
  };
  walk(dxf.entities, new THREE.Matrix4().makeScale(scale, scale, scale), undefined, 0);

  const root = new THREE.Group();
  root.name = fileName;
  root.userData.source = { format: 'dxf', file: fileName, scale };
  for (const [layer, b] of byLayer) {
    if (!b.lines.length && !b.tris.length) continue;
    const g = new THREE.Group();
    g.name = layer;
    g.userData.bim = { type: b.tris.length ? 'IfcBuildingElementProxy' : 'IfcAnnotation', name: `Layer ${layer}`, guid: crypto.randomUUID(), props: { Layer: layer, Origem: fileName } };
    if (b.lines.length) {
      const geo = new THREE.BufferGeometry().setFromPoints(b.lines);
      geo.setAttribute('color', new THREE.Float32BufferAttribute(b.lineColors.flatMap(c => [c.r, c.g, c.b]), 3));
      g.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true })));
    }
    if (b.tris.length) {
      const geo = new THREE.BufferGeometry().setFromPoints(b.tris);
      geo.setAttribute('color', new THREE.Float32BufferAttribute(b.triColors.flatMap(c => [c.r, c.g, c.b]), 3));
      geo.computeVertexNormals();
      g.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.9 })));
    }
    root.add(g);
  }
  return root;
}

// ---------------------------------------------------------------- escrita

const ACI = [[1, 0xff0000], [2, 0xffff00], [3, 0x00ff00], [4, 0x00ffff], [5, 0x0000ff], [6, 0xff00ff], [7, 0xffffff], [8, 0x808080], [9, 0xc0c0c0],
  [30, 0xff7f00], [40, 0xffbf00], [140, 0x007fff], [150, 0x0000ff], [250, 0x333333], [253, 0xadadad], [33, 0xa5a57f], [43, 0xa58c52]];
function nearestAci(color) {
  let best = 7, bd = Infinity;
  for (const [i, hex] of ACI) {
    const c = new THREE.Color(hex);
    const d = (c.r - color.r) ** 2 + (c.g - color.g) ** 2 + (c.b - color.b) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

const layerName = s => String(s || '0').replace(/[<>/\\":;?*|=,`]/g, '_').slice(0, 250);
const f = n => (Math.abs(n) < 1e-9 ? 0 : n).toFixed(6);

/** DXF ASCII R12 em metros; malhas viram 3DFACE e linhas viram LINE. */
export function exportDxf(viewer) {
  const ents = [];
  const layers = new Map();
  const pt = (code, v) => `${10 + code}\n${f(v.x)}\n${20 + code}\n${f(v.y)}\n${30 + code}\n${f(v.z)}`;
  viewer.model.updateMatrixWorld(true);

  viewer.model.traverse(o => {
    if (!o.visible || !(o.isMesh || o.isLineSegments || o.isLine)) return;
    let owner = o;
    while (owner && !owner.userData?.bim) owner = owner.parent;
    const layer = layerName(owner?.userData.bim.props?.Layer || owner?.userData.bim.type || 'BoxBim');
    const mat = baseMaterial(o);
    const color = (Array.isArray(mat) ? mat[0] : mat)?.color || new THREE.Color(0xffffff);
    const aci = nearestAci(color);
    if (!layers.has(layer)) layers.set(layer, aci);
    const tc = `420\n${(Math.round(color.r * 255) << 16) | (Math.round(color.g * 255) << 8) | Math.round(color.b * 255)}`;
    const pos = o.geometry.attributes.position;
    const index = o.geometry.index;
    const V = i => new THREE.Vector3().fromBufferAttribute(pos, index ? index.getX(i) : i).applyMatrix4(o.matrixWorld);
    const n = index ? index.count : pos.count;
    if (o.isMesh) {
      for (let i = 0; i + 2 < n; i += 3) {
        const a = V(i), b = V(i + 1), c = V(i + 2);
        ents.push(`0\n3DFACE\n8\n${layer}\n62\n${aci}\n${tc}\n${pt(0, a)}\n${pt(1, b)}\n${pt(2, c)}\n${pt(3, c)}`);
      }
    } else {
      const step = o.isLineSegments ? 2 : 1;
      for (let i = 0; i + 1 < n; i += step) {
        ents.push(`0\nLINE\n8\n${layer}\n62\n${aci}\n${tc}\n${pt(0, V(i))}\n${pt(1, V(i + 1))}`);
      }
    }
  });

  const layerTable = [...layers].map(([name, aci]) => `0\nLAYER\n2\n${name}\n70\n0\n62\n${aci}\n6\nCONTINUOUS`).join('\n');
  return [
    '0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1009\n9\n$INSUNITS\n70\n6\n0\nENDSEC',
    `0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLAYER\n70\n${layers.size}\n${layerTable}\n0\nENDTAB\n0\nENDSEC`,
    `0\nSECTION\n2\nENTITIES\n${ents.join('\n')}\n0\nENDSEC`,
    '0\nEOF\n',
  ].join('\n');
}
