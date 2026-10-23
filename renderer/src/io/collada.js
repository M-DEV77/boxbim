// Exportador COLLADA 1.4.1 (o three.js e o Blender 5.x não exportam mais .dae).
// Geometria em coordenadas de mundo, Z para cima, metros.
import * as THREE from 'three';
import { baseMaterial } from '../viewer.js';

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = v => (Math.abs(v) < 1e-9 ? 0 : +v.toFixed(6));

export function exportCollada(viewer, { title = 'BoxBim' } = {}) {
  const effects = [], materials = [], geometries = [], nodes = [];
  const matIds = new Map();
  viewer.model.updateMatrixWorld(true);

  const materialId = mat => {
    const m = Array.isArray(mat) ? mat[0] : mat;
    const c = m?.color || new THREE.Color(0xcccccc);
    const a = m?.transparent ? m.opacity : 1;
    const key = c.getHexString() + a;
    if (!matIds.has(key)) {
      const id = `mat_${matIds.size}`;
      matIds.set(key, id);
      effects.push(`<effect id="${id}-fx"><profile_COMMON><technique sid="common"><lambert>
<diffuse><color sid="diffuse">${n(c.r)} ${n(c.g)} ${n(c.b)} 1</color></diffuse>
<transparency><float sid="transparency">${n(a)}</float></transparency>
</lambert></technique></profile_COMMON></effect>`);
      materials.push(`<material id="${id}" name="${id}"><instance_effect url="#${id}-fx"/></material>`);
    }
    return matIds.get(key);
  };

  let gi = 0;
  viewer.model.traverse(o => {
    if (!o.isMesh || !o.visible) return;
    const g = o.geometry;
    const pos = g.attributes.position;
    if (!pos || pos.count < 3) return;
    const nm = new THREE.Matrix3().getNormalMatrix(o.matrixWorld);
    const P = [], N = [];
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      P.push(n(v.x), n(v.y), n(v.z));
    }
    const nor = g.attributes.normal;
    if (nor) for (let i = 0; i < nor.count; i++) {
      v.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
      N.push(n(v.x), n(v.y), n(v.z));
    }
    const idx = [];
    const count = g.index ? g.index.count : pos.count;
    for (let i = 0; i < count; i++) {
      const k = g.index ? g.index.getX(i) : i;
      idx.push(k);
      if (N.length) idx.push(k);
    }
    const tris = Math.floor(count / 3);
    let owner = o;
    while (owner && !owner.userData?.bim) owner = owner.parent;
    const name = esc(owner?.userData.bim.name || o.name || `mesh_${gi}`);
    const id = `geom_${gi++}`;
    const mid = materialId(baseMaterial(o));
    geometries.push(`<geometry id="${id}" name="${name}"><mesh>
<source id="${id}-pos"><float_array id="${id}-pos-arr" count="${P.length}">${P.join(' ')}</float_array>
<technique_common><accessor source="#${id}-pos-arr" count="${pos.count}" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source>
${N.length ? `<source id="${id}-nor"><float_array id="${id}-nor-arr" count="${N.length}">${N.join(' ')}</float_array>
<technique_common><accessor source="#${id}-nor-arr" count="${N.length / 3}" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source>` : ''}
<vertices id="${id}-vtx"><input semantic="POSITION" source="#${id}-pos"/></vertices>
<triangles material="m0" count="${tris}"><input semantic="VERTEX" source="#${id}-vtx" offset="0"/>${N.length ? `<input semantic="NORMAL" source="#${id}-nor" offset="1"/>` : ''}
<p>${idx.slice(0, tris * 3 * (N.length ? 2 : 1)).join(' ')}</p></triangles>
</mesh></geometry>`);
    nodes.push(`<node id="node_${id}" name="${name}" type="NODE"><instance_geometry url="#${id}"><bind_material><technique_common>
<instance_material symbol="m0" target="#${mid}"/></technique_common></bind_material></instance_geometry></node>`);
  });

  const now = new Date().toISOString();
  return `<?xml version="1.0" encoding="utf-8"?>
<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">
<asset><contributor><authoring_tool>BoxBim</authoring_tool></contributor><created>${now}</created><modified>${now}</modified>
<unit name="meter" meter="1"/><up_axis>Z_UP</up_axis></asset>
<library_effects>${effects.join('\n')}</library_effects>
<library_materials>${materials.join('\n')}</library_materials>
<library_geometries>${geometries.join('\n')}</library_geometries>
<library_visual_scenes><visual_scene id="scene" name="${esc(title)}">${nodes.join('\n')}</visual_scene></library_visual_scenes>
<scene><instance_visual_scene url="#scene"/></scene>
</COLLADA>
`;
}
