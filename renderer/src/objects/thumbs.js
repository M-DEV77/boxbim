// Miniaturas dos Objetos: gera a geometria com os valores padrão e fotografa em vista isométrica (PNG 256×256).
// Usado no editor (biblioteca ao inserir) e na página da biblioteca; a imagem fica no banco (objects:meta).
import * as THREE from 'three';

let renderer = null;
const SIZE = 256;

function setup() {
  if (renderer) return renderer;
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(SIZE, SIZE);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  return renderer;
}

/** dataURL PNG da miniatura do objeto (lança se o script do objeto tiver erro). */
export async function objectThumbnail(library, def) {
  const r = setup();
  const { meshes } = await library.generate(def, {});
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8070, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(3, -4, 6);
  scene.add(sun);
  const g = new THREE.Group();
  meshes.forEach(m => g.add(m));
  scene.add(g);
  const box = new THREE.Box3().setFromObject(g);
  if (box.isEmpty()) throw new Error('O objeto não gerou geometria.');
  const c = box.getCenter(new THREE.Vector3());
  const R = Math.max(0.05, box.getSize(new THREE.Vector3()).length() / 2);
  const cam = new THREE.PerspectiveCamera(30, 1, R / 50, R * 50);
  cam.up.set(0, 0, 1);
  cam.position.copy(c).add(new THREE.Vector3(1, -1.25, 0.9).normalize().multiplyScalar(R / Math.sin(15 * Math.PI / 180) * 1.05));
  cam.lookAt(c);
  r.setClearColor(0x000000, 0);
  r.render(scene, cam);
  const url = r.domElement.toDataURL('image/png');
  g.traverse(o => o.geometry?.dispose());
  return url;
}

/** Gera e grava as miniaturas que faltam (uma por vez; devolve quantas foram feitas). */
export async function fillThumbnails(library, { onProgress, force = false } = {}) {
  const todo = library.items.filter(o => !o.broken && (force || !o.miniatura));
  let n = 0;
  for (const def of todo) {
    try {
      const url = await objectThumbnail(library, def);
      await window.boxbim.objects.meta(def.id, { miniatura: url }, { geral: def.escopo !== 'projeto' });
      def.miniatura = url;
      n++;
    } catch (e) { console.warn('miniatura', def.name, e.message); }
    onProgress?.(n, todo.length);
  }
  return n;
}
