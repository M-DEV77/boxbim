// GRADE e PONTO BASE em todas as vistas.
//   - 3D: grade no chão (cota 0); plantas de piso e de forro: na cota do nível; elevações: num plano vertical
//     de frente para quem olha (passando pela origem); grade infinita (shader), mais forte a cada 5 e 25 passos;
//   - ponto base (0, 0, 0): círculo com cruz, como o ponto base do projeto no Revit, e os eixos X/Y/Z;
//   - ficam na camada sem recorte do viewer (não são cortados pelo plano de corte das plantas) e testam
//     profundidade contra o modelo (o que está atrás de uma parede some atrás dela).
// O espaçamento é do projeto (dados.grade.espacamento); mostrar/ocultar é de cada usuário (fica neste navegador).
import * as THREE from 'three';

const DARK = { minor: 0x2c333d, major: 0x46505f, base: 0xe0a33a };
const PAPER = { minor: 0xd9dde3, major: 0xb5bcc6, base: 0xc0392b };

// Grade INFINITA: um plano grande com as linhas calculadas no shader (antisserrilhadas por fwidth). Três níveis
// — passo, 5× e 25× — que somem sozinhos quando ficam pequenos demais na tela (zoom afastado) e reaparecem ao
// aproximar; na perspectiva, a grade se desfaz com a distância em vez de terminar numa borda.
const GRID_SIZE = 40000;
const GRID_VERT = `
varying vec2 vLocal;
varying vec3 vWorld;
void main() {
  vLocal = position.xy;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const GRID_FRAG = `
uniform float uStep;
uniform vec3 uMinor;
uniform vec3 uMajor;
uniform float uFade;
varying vec2 vLocal;
varying vec3 vWorld;
// 1 sobre a linha, 0 fora (com ~1 px de transição)
float lineAt(float s) {
  vec2 c = vLocal / s;
  vec2 d = fwidth(c);
  vec2 g = abs(fract(c - 0.5) - 0.5) / max(d, vec2(1e-6));
  return 1.0 - min(min(g.x, g.y), 1.0);
}
// some quando a célula fica com poucos pixels na tela
float lod(float s) {
  vec2 d = fwidth(vLocal / s);
  return 1.0 - smoothstep(0.12, 0.3, max(d.x, d.y));
}
void main() {
  float a0 = lineAt(uStep) * lod(uStep) * 0.6;
  float a1 = lineAt(uStep * 5.0) * lod(uStep * 5.0);
  float a2 = lineAt(uStep * 25.0) * lod(uStep * 25.0);
  float am = max(a1, a2);
  float a = max(a0, am);
  if (a < 0.01) discard;
  vec3 col = am >= a0 ? uMajor : uMinor;
  float fade = uFade > 0.0 ? 1.0 - smoothstep(uFade * 0.35, uFade, distance(vWorld, cameraPosition)) : 1.0;
  gl_FragColor = vec4(col, a * fade);
}`;

function infiniteGrid(step, colors, viewer) {
  const mat = new THREE.ShaderMaterial({
    vertexShader: GRID_VERT, fragmentShader: GRID_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { uStep: { value: step }, uMinor: { value: new THREE.Color(colors.minor) }, uMajor: { value: new THREE.Color(colors.major) }, uFade: { value: 0 } },
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(GRID_SIZE, GRID_SIZE), mat);
  mesh.raycast = () => {};
  mesh.frustumCulled = false;
  // perspectiva: some a uma distância proporcional à da câmera ao alvo; ortográfica: sem esmaecer
  mesh.onBeforeRender = (r, sc, cam) => {
    mat.uniforms.uFade.value = cam.isPerspectiveCamera ? Math.max(60, cam.position.distanceTo(viewer.controls.target) * 8) : 0;
  };
  return mesh;
}

/** Ponto base: círculo com cruz (no plano XY local) + eixos curtos. */
function basePoint(r, color) {
  const g = new THREE.Group();
  const circle = [];
  for (let i = 0; i <= 48; i++) { const a = i / 48 * Math.PI * 2; circle.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0)); }
  const mat = new THREE.LineBasicMaterial({ color, depthTest: false });
  const ring = new THREE.Line(new THREE.BufferGeometry().setFromPoints(circle), mat);
  const cross = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-r * 1.6, 0, 0), new THREE.Vector3(r * 1.6, 0, 0), new THREE.Vector3(0, -r * 1.6, 0), new THREE.Vector3(0, r * 1.6, 0)]), mat);
  const dot = new THREE.Mesh(new THREE.CircleGeometry(r * 0.22, 20), new THREE.MeshBasicMaterial({ color, depthTest: false, side: THREE.DoubleSide }));
  g.add(ring, cross, dot);
  g.renderOrder = 8;
  g.traverse(o => { o.renderOrder = 8; });
  return g;
}

export class Guides {
  constructor(viewer) {
    this.viewer = viewer;
    this.group = new THREE.Group();
    this.group.name = 'Grade e ponto base';
    viewer.overlay.add(this.group);
    this.step = 1;
    try { this.visible = localStorage.getItem('boxbim.gradeOculta') !== '1'; } catch { this.visible = true; }
    // a grade e os eixos antigos do viewer saem de cena: tudo passa por aqui
    viewer.grid.visible = false;
    viewer.axes.visible = false;
    viewer.grid.removeFromParent();
    viewer.axes.removeFromParent();
    this.axes = new THREE.AxesHelper(1.2);
    this.axes.material.depthTest = false;
    this.axes.renderOrder = 8;
  }

  setOptions({ espacamento } = {}) {
    if (espacamento) this.step = Math.max(0.05, Number(espacamento) || 1);
    if (this.last) this.update(this.last.view, this.last.opts);
  }

  /** Mostrar/ocultar grade e ponto base (preferência deste usuário, em todas as vistas). */
  setVisible(on) {
    this.visible = !!on;
    try { localStorage.setItem('boxbim.gradeOculta', on ? '0' : '1'); } catch { /* sem armazenamento */ }
    if (this.last) this.update(this.last.view, this.last.opts);
  }

  /** Recria grade e ponto base para a vista (kind, nível, direção) e o fundo (papel ou escuro). */
  update(view, { paper = false, z = 0, hidden = false } = {}) {
    this.last = { view, opts: { paper, z, hidden } };
    const g = this.group;
    for (const c of [...g.children]) { g.remove(c); c.traverse(o => { o.geometry?.dispose(); o.material?.dispose?.(); }); }
    g.visible = this.visible && !hidden;
    if (!g.visible) return;
    const colors = paper ? PAPER : DARK;
    const box = this.viewer.modelBox();
    const size = box.isEmpty() ? 20 : Math.max(20, box.getSize(new THREE.Vector3()).length() * 1.5);
    const grid = infiniteGrid(this.step, colors, this.viewer);
    const mark = basePoint(Math.max(0.15, Math.min(500, size) / 120), colors.base);
    const holder = new THREE.Group();
    holder.add(grid, mark);
    if (view.kind === 'elevation') {
      // plano vertical perpendicular à direção de visão, passando pela origem
      const d = new THREE.Vector3(...view.dir).normalize();
      holder.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), d.clone().negate());
      // o "para cima" da grade no plano vertical precisa ser Z
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(holder.quaternion);
      const ang = Math.atan2(up.clone().cross(new THREE.Vector3(0, 0, 1)).dot(d.clone().negate()), up.dot(new THREE.Vector3(0, 0, 1)));
      holder.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), ang));
    } else {
      holder.position.z = z - 0.004; // logo abaixo do piso (evita disputar com a face de cima das lajes)
    }
    g.add(holder);
    const axes = this.axes;
    axes.position.set(0, 0, view.kind === 'elevation' ? 0 : z);
    g.add(axes);
  }
}
