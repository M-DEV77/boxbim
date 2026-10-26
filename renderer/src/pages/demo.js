// PÁGINA DE DEMONSTRAÇÃO (entrada de quem ainda não entrou): a "Casa Horizonte" montada no navegador com os
// materiais procedurais do BoxBim (materials.js), céu e sol em tempo real e a câmera passeando sozinha. O sol desce
// até o entardecer durante a demonstração e as luzes de dentro acendem. Depois de N minutos (/api/demo) a tela de
// login cobre a cena; antes disso, o botão Entrar abre o login (e dá para voltar).
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { createMaterial, boxUv, setCustomTextures, TEXTURE_TEMPLATES } from '../materials.js';

const $ = s => document.querySelector(s);
const DEG = Math.PI / 180;
const nextFrame = () => new Promise(r => setTimeout(r, 40)); // deixa o navegador pintar o "gerando…"

// ---------------------------------------------------------------- cena (Y para cima; a casa é modelada com Z para cima)

const canvas = $('#demo-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.6;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 3000);
camera.position.set(-22, 9, 24);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 2.6, 1.5);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 8;
controls.maxDistance = 70;
controls.maxPolarAngle = 86 * DEG;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.35;

// o usuário mexeu: a câmera para de girar sozinha por um tempo
let idleT;
controls.addEventListener('start', () => { controls.autoRotate = false; clearTimeout(idleT); });
controls.addEventListener('end', () => { clearTimeout(idleT); idleT = setTimeout(() => { controls.autoRotate = true; }, 9000); });

const world = new THREE.Group();
world.rotation.x = -Math.PI / 2; // Z da casa → Y da cena
scene.add(world);

// céu físico + sol (a luz do ambiente vem do próprio céu, refeito de tempos em tempos)
const sky = new Sky();
sky.scale.setScalar(4000);
for (const s of [sky]) {
  s.material.uniforms.turbidity.value = 2.5;
  s.material.uniforms.rayleigh.value = 1.2;
  s.material.uniforms.mieCoefficient.value = 0.003;
  s.material.uniforms.mieDirectionalG.value = 0.85;
}
scene.add(sky);
const sun = new THREE.DirectionalLight(0xffffff, 3);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.bias = -0.0002;
sun.shadow.normalBias = 0.03;
Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 160 });
scene.add(sun, sun.target);
const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x4a5a3a, 0.25);
scene.add(hemi);

const pmrem = new THREE.PMREMGenerator(renderer);
const skyScene = new THREE.Scene();
const skyForEnv = new Sky();
skyForEnv.scale.setScalar(1000);
for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) skyForEnv.material.uniforms[k].value = sky.material.uniforms[k].value;
skyScene.add(skyForEnv);
let envRT = null;

const sunVec = new THREE.Vector3();
/** Sol pela altura (graus) e azimute (graus a partir do Norte = −Z da cena, sentido horário). */
function setSun(elev, azim) {
  sunVec.setFromSphericalCoords(1, (90 - elev) * DEG, (180 - azim) * DEG);
  for (const s of [sky, skyForEnv]) s.material.uniforms.sunPosition.value.copy(sunVec);
  sun.position.copy(sunVec).multiplyScalar(80);
  const warm = THREE.MathUtils.clamp((elev - 2) / 30, 0, 1);
  sun.color.setRGB(1, 0.62 + 0.36 * warm, 0.38 + 0.55 * warm);
  sun.intensity = 0.6 + 4.2 * THREE.MathUtils.clamp(elev / 25, 0, 1);
  hemi.intensity = 0.12 + 0.2 * warm;
  renderer.toneMappingExposure = 0.55 + 0.35 * (1 - warm);
  const old = envRT;
  envRT = pmrem.fromScene(skyScene, 0, 0.1, 1000);
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.3 + 0.3 * warm;
  old?.dispose();
  // luzes de dentro acendem com o fim da tarde
  const night = 1 - THREE.MathUtils.clamp((elev - 3) / 18, 0, 1);
  for (const m of glowMats) m.emissiveIntensity = 0.4 + 3.2 * night;
  for (const l of interiorLights) l.intensity = 2 + 26 * night;
}

// ---------------------------------------------------------------- materiais (os mesmos do Render do BoxBim)

const glowMats = [], interiorLights = [];
let M;

function makeMaterials() {
  // texturas próprias (camadas), como o usuário faria no Editor de texturas
  setCustomTextures({
    pedra: TEXTURE_TEMPLATES.pedra,
    agua: { nome: 'Água', camadas: [{ gerador: 'ruido', escala: 5, oitavas: 3, canais: ['altura'], de: 0.2, ate: 1 }, { gerador: 'ondas', escala: 3, distorcao: 6, canais: ['altura'], modo: 'somar', forca: 0.4 }] },
  });
  const mk = (name, color, render = {}) => createMaterial(name, { color, render });
  M = {
    reboco: mk('Reboco', '#eeeae2', { escala: 0.8, normal: 0.6 }),
    concreto: mk('Concreto', '#b8b6b0', { escala: 1.6, normal: 0.9 }),
    madeira: mk('Madeira', '#87562f', { textura: 'madeira', escala: 2.2, rugosidade: 0.55, normal: 1.1 }),
    deck: mk('Deck', '#9a6a3f', { textura: 'madeira', escala: 1.4, rugosidade: 0.62, normal: 1.3, deslocamento: 0.3 }),
    pedra: mk('Pedra', '#a8a196', { textura: 'tx:pedra', escala: 1.6, rugosidade: 0.9, normal: 1.6, deslocamento: 1.4, ao: 1.3 }),
    piso: mk('Porcelanato', '#dcd6cc', { escala: 1.6 }),
    pastilha: mk('Pastilha', '#5fb7cf', { textura: 'pastilha', escala: 0.5, rugosidade: 0.25, normal: 0.8 }),
    grama: mk('Grama', '#5d8a42', { textura: 'grama', escala: 2.5, rugosidade: 1, normal: 0.9 }),
    caminho: mk('Concreto', '#c9c4ba', { textura: 'concreto', escala: 1, normal: 1, rugosidade: 0.9 }),
    esquadria: mk('Aço', '#2a2e33', { textura: 'nenhuma', rugosidade: 0.38, metal: 0.85 }),
    vidro: mk('Vidro', '#b9dcee', { transmissao: 0, opacidade: 0.26, rugosidade: 0.02, especular: 1 }),
    agua: mk('Água', '#2a9fc3', { textura: 'tx:agua', escala: 2.2, opacidade: 0.62, rugosidade: 0.03, normal: 0.7, relevo: 0, ao: 0, mapaRugosidade: false }),
    tronco: mk('Madeira', '#4e3523', { textura: 'madeira', escala: 0.6, rugosidade: 0.9 }),
    sofa: new THREE.MeshStandardMaterial({ color: 0x8c8a84, roughness: 0.9 }),
    tapete: new THREE.MeshStandardMaterial({ color: 0x6b5446, roughness: 1 }),
  };
  for (const c of ['#2f5f2b', '#3d7030', '#2a5225', '#47782f']) (M.folhas ||= []).push(new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, flatShading: true }));
  const glow = new THREE.MeshStandardMaterial({ color: 0xfff1d8, emissive: 0xffc98a, emissiveIntensity: 0.5 });
  glowMats.push(glow);
  M.luz = glow;
}

// ---------------------------------------------------------------- geometria (Z para cima, metros)

function add(geo, mat, { cast = true, receive = true } = {}) {
  boxUv(geo);
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast;
  m.receiveShadow = receive;
  world.add(m);
  return m;
}

/** Caixa alinhada aos eixos entre dois cantos. */
function box(x0, y0, z0, x1, y1, z1, mat, opts) {
  const g = new THREE.BoxGeometry(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0));
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return add(g, mat, opts);
}

/**
 * Parede reta de (x0, y0) a (x1, y1), base z0, altura h, espessura t (centrada no eixo), com vãos
 * [deslocamento, peitoril, largura, altura]; cada vão ganha vidro e caixilho.
 */
function wall(x0, y0, x1, y1, z0, h, t, mat, vaos = [], { vidro = true, montantes = 0 } = {}) {
  const len = Math.hypot(x1 - x0, y1 - y0), ang = Math.atan2(y1 - y0, x1 - x0);
  const s = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(len, 0), new THREE.Vector2(len, h), new THREE.Vector2(0, h)]);
  for (const [o, b, w, hh] of vaos) s.holes.push(new THREE.Path([new THREE.Vector2(o, b), new THREE.Vector2(o + w, b), new THREE.Vector2(o + w, b + hh), new THREE.Vector2(o, b + hh)]));
  const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false });
  g.rotateX(Math.PI / 2);      // perfil no plano XZ, espessura para −Y
  g.translate(0, t / 2, 0);    // centrada no eixo da parede
  const m = add(g, mat);
  m.position.set(x0, y0, z0);
  m.rotation.z = ang;
  if (vidro) {
    for (const [o, b, w, hh] of vaos) {
      const grp = new THREE.Group();
      grp.position.set(x0, y0, z0);
      grp.rotation.z = ang;
      world.add(grp);
      const pane = new THREE.Mesh(new THREE.BoxGeometry(w, 0.02, hh), M.vidro);
      pane.position.set(o + w / 2, 0, b + hh / 2);
      pane.receiveShadow = true;
      grp.add(pane);
      const fr = 0.05, d = Math.min(t, 0.08);
      const frame = (cx, cz, sx, sz) => { const f = new THREE.Mesh(new THREE.BoxGeometry(sx, d, sz), M.esquadria); f.position.set(cx, 0, cz); f.castShadow = true; grp.add(f); };
      frame(o + w / 2, b + fr / 2, w, fr); frame(o + w / 2, b + hh - fr / 2, w, fr);
      frame(o + fr / 2, b + hh / 2, fr, hh); frame(o + w - fr / 2, b + hh / 2, fr, hh);
      const n = montantes || Math.max(0, Math.round(w / 1.6) - 1);
      for (let i = 1; i <= n; i++) frame(o + (w * i) / (n + 1), b + hh / 2, fr * 0.8, hh);
    }
  }
  return m;
}

function tree(x, y, s = 1, seed = 1) {
  const rnd = (k => () => { k = (k * 16807) % 2147483647; return k / 2147483647; })(Math.floor(seed * 7919) + 13);
  const trunkH = 2.2 * s;
  const tr = new THREE.CylinderGeometry(0.1 * s, 0.17 * s, trunkH, 10).rotateX(Math.PI / 2).translate(x, y, trunkH / 2);
  add(tr, M.tronco);
  for (let i = 0; i < 4; i++) {
    const r = (1 + rnd() * 0.7) * s;
    const g = new THREE.IcosahedronGeometry(r, 1);
    g.translate(x + (rnd() - 0.5) * 1.4 * s, y + (rnd() - 0.5) * 1.4 * s, trunkH + r * 0.6 + rnd() * 1.1 * s);
    add(g, M.folhas[i % M.folhas.length]);
  }
}

function shrub(x, y, r, i) {
  const g = new THREE.IcosahedronGeometry(r, 1).scale(1, 1, 0.7).translate(x, y, r * 0.55);
  add(g, M.folhas[i % M.folhas.length]);
}

function buildHouse() {
  // terreno e caminhos
  add(new THREE.CircleGeometry(160, 96), M.grama, { cast: false });
  box(-9, -4.4, -0.02, 7.2, 5.4, 0.12, M.caminho, { cast: false });                  // calçada em volta da casa
  box(7.2, -1.6, -0.02, 22, 0.4, 0.06, M.caminho, { cast: false });                 // acesso lateral
  for (let i = 0; i < 7; i++) box(9.5 + i * 1.8, -6.6, 0, 10.6 + i * 1.8, -5.6, 0.07, M.caminho, { cast: false }); // pisantes

  // deck de madeira com o vão da piscina
  const deck = new THREE.Shape([new THREE.Vector2(-9, -14), new THREE.Vector2(7.2, -14), new THREE.Vector2(7.2, -4.4), new THREE.Vector2(-9, -4.4)]);
  deck.holes.push(new THREE.Path([new THREE.Vector2(-6.5, -11.6), new THREE.Vector2(3.5, -11.6), new THREE.Vector2(3.5, -7.4), new THREE.Vector2(-6.5, -7.4)]));
  add(new THREE.ExtrudeGeometry(deck, { depth: 0.18, bevelEnabled: false }).translate(0, 0, 0.1), M.deck, { cast: false });

  // piscina: bacia de pastilha (vista por dentro) e a água
  const basin = new THREE.BoxGeometry(10, 4.2, 1.5).translate(-1.5, -9.5, -0.47);
  M.pastilha.side = THREE.BackSide; // vista por dentro
  add(basin, M.pastilha, { cast: false });
  const water = add(new THREE.PlaneGeometry(10, 4.2).translate(-1.5, -9.5, 0.16), M.agua, { cast: false });
  water.renderOrder = 2;
  // borda de pedra
  box(-6.8, -11.9, 0.1, 3.8, -11.6, 0.33, M.piso); box(-6.8, -7.4, 0.1, 3.8, -7.1, 0.33, M.piso);
  box(-6.8, -11.6, 0.1, -6.5, -7.4, 0.33, M.piso); box(3.5, -11.6, 0.1, 3.8, -7.4, 0.33, M.piso);

  // TÉRREO (12 × 8 m): laje de piso, paredes de 3 m, fachada de vidro voltada à piscina
  const z0 = 0.35, H = 3, T = 0.22;
  box(-7.3, -4.3, 0.1, 5.3, 4.3, z0, M.concreto);
  box(-7, -4, z0 - 0.02, 5, 4, z0 + 0.01, M.piso, { cast: false });
  wall(-7, -4, 5, -4, z0, H, T, M.reboco, [[0.5, 0.05, 8.6, 2.85]], { montantes: 4 });          // frente: pano de vidro
  wall(-7, 4, -7, -4, z0, H, 0.42, M.pedra, [], { vidro: false });                                   // parede de pedra
  wall(5, -4, 5, 4, z0, H, T, M.reboco, [[2.4, 0, 1.1, 2.3], [4.6, 0.9, 2.2, 1.5]]);                 // lateral: porta e janela
  wall(5, 4, -7, 4, z0, H, T, M.reboco, [[1.2, 1, 3, 1.4], [6.6, 1, 3, 1.4]]);                       // fundos
  box(-7.2, -4.2, z0 + H, 5.2, 4.2, z0 + H + 0.32, M.concreto);                                      // laje do 1º andar (térreo)

  // interior: luz de teto, sofá, mesa, tapete
  box(-5, -2.2, z0 + H - 0.06, 2.5, -1.6, z0 + H - 0.02, M.luz, { cast: false });
  box(-5.6, -0.5, z0, -2.4, 0.5, z0 + 0.45, M.sofa); box(-5.6, 0.2, z0, -2.4, 0.5, z0 + 0.85, M.sofa);
  box(-4.8, -2.2, z0, -3.2, -1.2, z0 + 0.38, M.madeira);
  box(-6, -3, z0 + 0.005, -2, 1, z0 + 0.015, M.tapete, { cast: false });
  box(0.5, -1, z0, 3.5, 0.8, z0 + 0.76, M.madeira);                                                    // mesa de jantar
  const l1 = new THREE.PointLight(0xffc489, 2, 12, 2); l1.position.set(-1.5, -1.5, z0 + 2.4); world.add(l1); interiorLights.push(l1);

  // PAVIMENTO SUPERIOR em balanço (madeira), faixa de janelas voltada à piscina
  const z1 = z0 + H + 0.32, H2 = 2.9;
  wall(-4, -5.2, 8.5, -5.2, z1, H2, T, M.madeira, [[0.8, 0.7, 10.6, 1.6]], { montantes: 5 });
  wall(8.5, -5.2, 8.5, 3.6, z1, H2, T, M.madeira, [[2.5, 0.7, 3.8, 1.6]]);
  wall(8.5, 3.6, -4, 3.6, z1, H2, T, M.madeira, [[2, 0.9, 2.2, 1.2], [7.4, 0.9, 2.2, 1.2]]);
  wall(-4, 3.6, -4, -5.2, z1, H2, T, M.reboco, [[2.6, 0.7, 3.4, 1.6]]);
  box(-4.1, -5.3, z1 - 0.34, 8.6, 3.7, z1 - 0.03, M.concreto);                                        // laje em balanço
  box(-4.1, -5.3, z1 - 0.02, 8.6, 3.7, z1 + 0.05, M.piso, { cast: false });
  box(-4.6, -5.9, z1 + H2, 9.1, 4.2, z1 + H2 + 0.35, M.concreto);                                      // cobertura com beiral
  box(-1, -3.6, z1 + H2 - 0.06, 6, -3, z1 + H2 - 0.02, M.luz, { cast: false });
  const l2 = new THREE.PointLight(0xffc489, 2, 12, 2); l2.position.set(2.5, -2.5, z1 + 2.2); world.add(l2); interiorLights.push(l2);
  // pilares metálicos sob o balanço
  for (const [x, y] of [[8.2, -4.9], [8.2, 3.3]]) box(x - 0.1, y - 0.1, 0.12, x + 0.1, y + 0.1, z1, M.esquadria);

  // jardim
  // árvores nos fundos e longe do passeio da câmera (que gira a ~30 m)
  const trees = [[-12, 9, 1.1], [-4, 12, 1.3], [5, 11.5, 1.05], [14, 9, 1.2], [-17, 1, 0.95], [19, -3, 1], [-38, -20, 1.4], [36, -26, 1.3], [-30, 30, 1.5], [32, 28, 1.4], [0, 40, 1.6]];
  trees.forEach(([x, y, s], i) => tree(x, y, s, i + 1));
  // arbustos: fileira nos fundos e na lateral da parede de pedra
  for (let i = 0; i < 10; i++) shrub(-8 + i * 1.6, 6.2 + (i % 2) * 0.4, 0.55 + (i % 3) * 0.15, i);
  for (let i = 0; i < 6; i++) shrub(-10.2 - (i % 2) * 0.5, -3 + i * 1.5, 0.5 + (i % 3) * 0.15, i + 1);
}

// ---------------------------------------------------------------- pós-processamento e laço

const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
composer.addPass(new RenderPass(scene, camera));
const gtao = new GTAOPass(scene, camera, 1, 1);
gtao.updateGtaoMaterial({ radius: 0.7, distanceExponent: 1.5, thickness: 1, scale: 1 });
gtao.blendIntensity = 0.85;
composer.addPass(gtao);
composer.addPass(new OutputPass());

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

let start = 0, minutes = 5, lastSun = -1;
const SUN_FROM = 34, SUN_TO = 4, AZ_FROM = 230, AZ_TO = 262;
const clock = new THREE.Clock();

function loop() {
  const dt = Math.min(0.1, clock.getDelta());
  controls.update(dt);
  // água: as ondas andam
  for (const k of ['normalMap', 'map']) { const t = M.agua[k]; if (t) { t.offset.x += dt * 0.012; t.offset.y += dt * 0.007; } }
  // o sol desce até o entardecer ao longo da demonstração (refaz o céu a cada ~1,5 s)
  const f = Math.min(1, (performance.now() - start) / (minutes * 60000));
  if (performance.now() - lastSun > 1500) { lastSun = performance.now(); setSun(SUN_FROM + (SUN_TO - SUN_FROM) * f, AZ_FROM + (AZ_TO - AZ_FROM) * f); }
  composer.render();
  requestAnimationFrame(loop);
}

// ---------------------------------------------------------------- tempo da demonstração e login por cima

const loginBox = $('#demo-login');
let locked = false;
function showLogin(final) {
  loginBox.hidden = false;
  document.body.classList.add('demo-blur');
  if (final) {
    locked = true;
    $('#demo-fechar').hidden = true;
    $('#demo-login-msg').textContent = 'Gostou? Entre ou crie sua conta para modelar no BoxBim.';
    $('#demo-timer').hidden = true;
  }
  loginBox.querySelector('input[name=email]')?.focus();
}
$('#demo-entrar').addEventListener('click', () => showLogin(false));
$('#demo-fechar').addEventListener('click', () => { if (locked) return; loginBox.hidden = true; document.body.classList.remove('demo-blur'); });

function tick() {
  const left = Math.max(0, minutes * 60000 - (performance.now() - start));
  const s = Math.ceil(left / 1000);
  $('#demo-timer').textContent = `Demonstração · ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  if (left <= 0) { showLogin(true); return; }
  setTimeout(tick, 500);
}

async function main() {
  resize();
  const cfg = await fetch('/api/demo').then(r => r.json()).catch(() => ({}));
  const q = Number(new URLSearchParams(location.search).get('segundos'));
  minutes = q > 0 ? q / 60 : (cfg.minutos || 5);
  fetch('/api/saude').then(r => r.json()).then(j => { $('#demo-versao').textContent = `v${j.versao}`; }).catch(() => {});
  await nextFrame(); // mostra o "gerando…" antes do trabalho pesado
  makeMaterials();
  buildHouse();
  start = performance.now();
  setSun(SUN_FROM, AZ_FROM);
  $('#demo-loading').hidden = true;
  tick();
  loop();
}
main();
