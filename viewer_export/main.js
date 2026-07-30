import {
  Application, Asset, AssetListLoader, Entity,
  FILLMODE_FILL_WINDOW, RESOLUTION_AUTO,
  StandardMaterial, Color, Texture, createMesh, MeshInstance,
  CULLFACE_FRONT, ADDRESS_CLAMP_TO_EDGE, FILTER_LINEAR, FILTER_LINEAR_MIPMAP_LINEAR, BLEND_NORMAL, Vec3, Quat, Mat4
} from 'playcanvas';

// =============================================================================
// Réglages ajustables EN DIRECT via le panneau (⚙), voir plus bas.
// Plus aucune valeur figée en dur : on règle, on regarde le résultat tout de
// suite, et le bouton "Copier les réglages" donne la valeur finale à noter.
// =============================================================================

const canvas = document.createElement('canvas');
document.body.insertBefore(canvas, document.getElementById('ui-overlay'));

const app = new Application(canvas, { graphicsDeviceOptions: { antialias: false } });
app.setCanvasFillMode(FILLMODE_FILL_WINDOW);
app.setCanvasResolution(RESOLUTION_AUTO);
app.start();
window.addEventListener('resize', () => app.resizeCanvas());

const loadingScreen = document.getElementById('loading-screen');
const loadingBarFill = document.getElementById('loading-bar-fill');
const loadingText = document.getElementById('loading-text');
const currentRoomEl = document.getElementById('current-room');
const calibToggle = document.getElementById('calib-toggle');
const calibPanel = document.getElementById('calib-panel');
const calibMirrorU = document.getElementById('calib-mirror-u');
const calibYaw = document.getElementById('calib-yaw');
const calibYawVal = document.getElementById('calib-yaw-val');
const calibPitch = document.getElementById('calib-pitch');
const calibPitchVal = document.getElementById('calib-pitch-val');
const calibRoll = document.getElementById('calib-roll');
const calibRollVal = document.getElementById('calib-roll-val');
const calibOrder = document.getElementById('calib-order');
const calibCamRoll = document.getElementById('calib-cam-roll');
const calibCamRollVal = document.getElementById('calib-cam-roll-val');
const calibExportBtn = document.getElementById('calib-export');

calibToggle.addEventListener('click', () => calibPanel.classList.toggle('hidden'));

// Réglage validé : mirrorU=true, yaw=180, extraBeforeBase=false
const calib = { mirrorU: true, yaw: 180, pitch: 0, roll: 0, extraBeforeBase: false };
calibMirrorU.checked = calib.mirrorU;
calibYaw.value = calib.yaw; calibYawVal.textContent = calib.yaw + '°';
calibOrder.checked = calib.extraBeforeBase;

// position d'un node (aucune transformation -- on ne touche plus à la scène)
function pos3(nodeData) {
  const p = nodeData.position;
  return new Vec3(p[0], p[1], p[2]);
}

function applyCalibToCurrentSphere() {
  if (!panoEntity || !currentNodeData) return;
  const renders = panoEntity.render ? [panoEntity.render] : panoEntity.findComponents('render');
  const materials = renders.flatMap(r => r.meshInstances.map(mi => mi.material));
  if (!materials.length) return;
  const { origWidth, paddedWidth } = textureAssets.get(currentNodeData.id);
  const innerScale = origWidth / paddedWidth;       // fraction de la texture occupée par l'image réelle
  const padFrac = (paddedWidth - origWidth) / 2 / paddedWidth; // marge de rembourrage de chaque côté
  for (const mat of materials) {
    if (calib.mirrorU) {
      mat.emissiveMapTiling.x = -innerScale;
      mat.emissiveMapOffset.x = padFrac + innerScale;
    } else {
      mat.emissiveMapTiling.x = innerScale;
      mat.emissiveMapOffset.x = padFrac;
    }
    mat.emissiveMapTiling.y = 1;
    mat.emissiveMapOffset.y = 0;
    mat.update();
  }

  const baseQuat = new Quat().setFromMat4(matFromRotationRows(currentNodeData.rotation_matrix));
  const extraQuat = new Quat().setFromEulerAngles(calib.pitch, calib.yaw, calib.roll);
  const finalQuat = calib.extraBeforeBase
    ? new Quat().mul2(baseQuat, extraQuat)  // base * extra : extra appliqué EN LOCAL, avant la base
    : new Quat().mul2(extraQuat, baseQuat); // extra * base : extra appliqué APRÈS, en monde
  panoEntity.setRotation(finalQuat);
}

calibMirrorU.addEventListener('change', () => { calib.mirrorU = calibMirrorU.checked; applyCalibToCurrentSphere(); });
calibOrder.addEventListener('change', () => { calib.extraBeforeBase = calibOrder.checked; applyCalibToCurrentSphere(); });
calibCamRoll.addEventListener('input', () => { camRoll = parseFloat(calibCamRoll.value); calibCamRollVal.textContent = camRoll + '°'; applyLook(); });
calibYaw.addEventListener('input', () => { calib.yaw = parseFloat(calibYaw.value); calibYawVal.textContent = calib.yaw + '°'; applyCalibToCurrentSphere(); });
calibPitch.addEventListener('input', () => { calib.pitch = parseFloat(calibPitch.value); calibPitchVal.textContent = calib.pitch + '°'; applyCalibToCurrentSphere(); });
calibRoll.addEventListener('input', () => { calib.roll = parseFloat(calibRoll.value); calibRollVal.textContent = calib.roll + '°'; applyCalibToCurrentSphere(); });
calibExportBtn.addEventListener('click', async () => {
  const txt = JSON.stringify(calib, null, 2);
  try { await navigator.clipboard.writeText(txt); calibExportBtn.textContent = 'Copié !'; }
  catch { console.log('Réglages calibration :', txt); calibExportBtn.textContent = 'Voir console'; }
  setTimeout(() => { calibExportBtn.textContent = 'Copier les réglages'; }, 1500);
});

// --- Charger hotspots.json ---------------------------------------------------
loadingText.textContent = 'Chargement de hotspots.json…';
const hsResp = await fetch('hotspots.json');
if (!hsResp.ok) {
  loadingText.textContent = "Erreur : hotspots.json introuvable à côté d'index.html.";
  throw new Error('hotspots.json introuvable');
}
const tourData = await hsResp.json();
const nodesById = new Map(tourData.spheres.map(s => [s.id, s]));

// --- Charger le splat (Model.sog) + le mesh sphère PlayCanvas (model.glb) --
loadingText.textContent = 'Chargement du modèle splat…';
const splatAsset = new Asset('tour-splat', 'gsplat', { url: tourData.splat_file || '../Model.sog' });
const sphereMeshAsset = new Asset('sphere-mesh', 'container', { url: '../model.glb' });
const failedAssets = [];
await new Promise(resolve => {
  splatAsset.on('load', () => loadingBarFill.style.width = '15%');
  sphereMeshAsset.on('load', () => loadingBarFill.style.width = '20%');
  splatAsset.on('error', (err) => {
    failedAssets.push({ name: 'splat', url: splatAsset.file?.url });
    console.error('[viewer] échec du chargement du splat :', err);
  });
  sphereMeshAsset.on('error', (err) => {
    failedAssets.push({ name: 'sphere-mesh', url: sphereMeshAsset.file?.url });
    console.error('[viewer] échec du chargement de model.glb :', err);
  });
  new AssetListLoader([splatAsset, sphereMeshAsset], app.assets).load(resolve);
});

// --- Images panoramas : chargées "à la main" puis REMBOURRÉES aux bords ----
// (dupliquer quelques pixels du bord droit avant le bord gauche et
// inversement) pour éviter la couture que réintroduit le filtrage
// mipmap/anisotrope à la frontière U=0/U=1, sans revenir en arrière sur la
// résolution qui a réglé le zigzag.
const PAD_PIXELS = 48;
function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}
function padEquirectCanvas(img, pad) {
  const w = img.width, h = img.height;
  const canvas = document.createElement('canvas');
  canvas.width = w + pad * 2;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, pad, 0);                               // image complète, décalée
  ctx.drawImage(img, w - pad, 0, pad, h, 0, 0, pad, h);       // bord droit -> avant le bord gauche
  ctx.drawImage(img, 0, 0, pad, h, w + pad, 0, pad, h);       // bord gauche -> après le bord droit
  return { canvas, origWidth: w };
}

const textureAssets = new Map(); // id -> { texture, origWidth, paddedWidth }
let loadedCount = 0;
loadingText.textContent = 'Chargement des images (0/' + tourData.spheres.length + ')…';
await Promise.all(tourData.spheres.map(async s => {
  try {
    const img = await loadImage(s.image);
    const { canvas, origWidth } = padEquirectCanvas(img, PAD_PIXELS);
    const tex = new Texture(app.graphicsDevice, {
      width: canvas.width,
      height: canvas.height,
      mipmaps: true,
      addressU: ADDRESS_CLAMP_TO_EDGE,
      addressV: ADDRESS_CLAMP_TO_EDGE,
      minFilter: FILTER_LINEAR_MIPMAP_LINEAR,
      magFilter: FILTER_LINEAR,
      anisotropy: app.graphicsDevice.maxAnisotropy
    });
    tex.setSource(canvas);
    textureAssets.set(s.id, { texture: tex, origWidth, paddedWidth: canvas.width });
  } catch (err) {
    failedAssets.push({ name: s.id, url: s.image });
    console.error(`[viewer] échec du chargement de l'image "${s.id}" (${s.image}) :`, err);
  } finally {
    loadedCount++;
    loadingBarFill.style.width = Math.round((loadedCount / tourData.spheres.length) * 100) + '%';
    loadingText.textContent = `Chargement des images (${loadedCount}/${tourData.spheres.length})…`;
  }
}));
if (failedAssets.length) {
  loadingText.textContent = `${failedAssets.length} fichier(s) n'ont pas pu être chargés (voir console F12).`;
  loadingBarFill.style.background = '#e05555';
}

// --- Entité splat, affichée seulement pendant les transitions ---------------
const splatEntity = new Entity('TourSplat');
splatEntity.addComponent('gsplat', { asset: splatAsset });
splatEntity.enabled = false;
app.root.addChild(splatEntity);

// --- Caméra fixe au centre, on regarde juste autour de soi ------------------
const camera = new Entity('MainCamera');
camera.addComponent('camera', { clearColor: new Color(0, 0, 0), nearClip: 0.05, farClip: 2000, fov: 75 });
app.root.addChild(camera);

let camYaw = 0, camPitch = 0, camRoll = 0;
function applyLook() { camera.setEulerAngles(camPitch, camYaw, camRoll); }

let dragging = false, lastX = 0, lastY = 0, downX = 0, downY = 0;
canvas.addEventListener('pointerdown', e => {
  dragging = true; lastX = e.clientX; lastY = e.clientY; downX = e.clientX; downY = e.clientY;
});
window.addEventListener('pointerup', e => {
  dragging = false;
  if (Math.hypot(e.clientX - downX, e.clientY - downY) <= 6) handleClick(e.clientX, e.clientY);
});
window.addEventListener('pointermove', e => {
  if (!dragging) return;
  camYaw -= (e.clientX - lastX) * 0.15;
  camPitch = Math.max(-85, Math.min(85, camPitch - (e.clientY - lastY) * 0.15));
  lastX = e.clientX; lastY = e.clientY;
  applyLook();
});

// -----------------------------------------------------------------------------
// Sphère équirectangulaire faite main : N (avant de la caméra) -> U=0,
// pôle nord (+Y) -> V=0. Le miroir horizontal ci-dessous est la correction
// validée dans Houdini.
// -----------------------------------------------------------------------------
function buildEquirectMesh(device, radius, segLon = 48, segLat = 32) {
  const positions = [], normals = [], uvs = [], indices = [];
  for (let lat = 0; lat <= segLat; lat++) {
    const theta = (lat / segLat) * Math.PI;
    const sinT = Math.sin(theta), cosT = Math.cos(theta);
    const v = lat / segLat;
    for (let lon = 0; lon <= segLon; lon++) {
      const phi = (lon / segLon) * 2 * Math.PI;
      const x = sinT * Math.sin(phi);
      const y = cosT;
      const z = sinT * Math.cos(phi);
      positions.push(x * radius, y * radius, z * radius);
      normals.push(x, y, z);
      let u = lon / segLon;
      u = u - Math.floor(u);
      uvs.push(u, v);
    }
  }
  for (let lat = 0; lat < segLat; lat++) {
    for (let lon = 0; lon < segLon; lon++) {
      const a = lat * (segLon + 1) + lon;
      const b = a + segLon + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  return createMesh(device, positions, { normals, uvs, indices });
}

function matFromRotationRows(rows) {
  const m = new Mat4();
  const d = m.data;
  d[0] = rows[0][0]; d[1] = rows[1][0]; d[2] = rows[2][0]; d[3] = 0;
  d[4] = rows[0][1]; d[5] = rows[1][1]; d[6] = rows[2][1]; d[7] = 0;
  d[8] = rows[0][2]; d[9] = rows[1][2]; d[10] = rows[2][2]; d[11] = 0;
  d[12] = 0; d[13] = 0; d[14] = 0; d[15] = 1;
  return m;
}

let panoEntity = null;
let currentNodeData = null;
const PANO_MESH_SOURCE = 'glb'; // 'glb' = mesh sphère de PlayCanvas (model.glb), 'custom' = mon mesh fait main

function showSphere(nodeData) {
  if (panoEntity) panoEntity.destroy();
  currentNodeData = nodeData;

  const mat = new StandardMaterial();
  mat.emissiveMap = textureAssets.get(nodeData.id).texture;
  mat.emissive = new Color(1, 1, 1);
  mat.diffuse = new Color(0, 0, 0);
  mat.useLighting = false;
  mat.cull = CULLFACE_FRONT; // on regarde l'intérieur de la sphère
  mat.update();

  if (PANO_MESH_SOURCE === 'glb' && sphereMeshAsset.resource) {
    panoEntity = sphereMeshAsset.resource.instantiateRenderEntity();
    panoEntity.name = `pano-${nodeData.id}`;
    // applique le matériau (texture de CE node) à tous les meshInstances
    // trouvés dans le mesh importé (racine + enfants éventuels)
    panoEntity.findComponents('render').forEach(render => {
      render.meshInstances.forEach(mi => { mi.material = mat; });
    });
  } else {
    panoEntity = new Entity(`pano-${nodeData.id}`);
    const mesh = buildEquirectMesh(app.graphicsDevice, 400, 128, 96);
    panoEntity.addComponent('render', { meshInstances: [new MeshInstance(mesh, mat)] });
  }
  if (PANO_MESH_SOURCE === 'glb') panoEntity.setLocalScale(400, 400, 400);
  panoEntity.setPosition(pos3(nodeData));

  app.root.addChild(panoEntity);
  applyCalibToCurrentSphere(); // applique yaw/pitch/roll/miroir courants du panneau

  camera.setPosition(pos3(nodeData));
  currentRoomEl.textContent = nodeData.id;

  rebuildMarkers(nodeData);
}

// --- Marqueurs hotspot : cœur + halo semi-transparent, sobre et discret ---
let markerEntities = [];
function rebuildMarkers(nodeData) {
  for (const m of markerEntities) { m.core.destroy(); m.halo.destroy(); }
  markerEntities = nodeData.hotspots.map(h => {
    const target = nodesById.get(h.target);
    const p = pos3(target);

    const coreMat = new StandardMaterial();
    coreMat.emissive = new Color(0.85, 0.92, 1);
    coreMat.diffuse = new Color(0, 0, 0);
    coreMat.useLighting = false;
    coreMat.update();

    const core = new Entity(`marker-core-${h.target}`);
    core.addComponent('render', { type: 'sphere', material: coreMat });
    core.setLocalScale(0.12, 0.12, 0.12);
    core.setPosition(p);
    app.root.addChild(core);

    const haloMat = new StandardMaterial();
    haloMat.emissive = new Color(0.6, 0.8, 1);
    haloMat.diffuse = new Color(0, 0, 0);
    haloMat.useLighting = false;
    haloMat.blendType = BLEND_NORMAL;
    haloMat.opacity = 0.25;
    haloMat.depthWrite = false;
    haloMat.update();

    const halo = new Entity(`marker-halo-${h.target}`);
    halo.addComponent('render', { type: 'sphere', material: haloMat });
    halo.setLocalScale(0.28, 0.28, 0.28);
    halo.setPosition(p);
    app.root.addChild(halo);

    return { core, halo, targetId: h.target };
  });
}

// légère pulsation du halo, discrète
app.on('update', () => {
  const s = 0.28 + Math.sin(performance.now() / 500) * 0.03;
  for (const m of markerEntities) m.halo.setLocalScale(s, s, s);
});

// --- Clic -> hotspot 3D le plus proche de la direction du clic -------------
function getViewProjMatrix() {
  const view = camera.getWorldTransform().clone().invert();
  return new Mat4().mul2(camera.camera.projectionMatrix, view);
}
function projectToScreen(worldPos, viewProj) {
  const m = viewProj.data;
  const x = worldPos.x, y = worldPos.y, z = worldPos.z;
  const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
  const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
  const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
  if (cw <= 0.0001) return null;
  const ndcX = cx / cw, ndcY = cy / cw;
  return {
    x: (ndcX * 0.5 + 0.5) * canvas.clientWidth,
    y: (1 - (ndcY * 0.5 + 0.5)) * canvas.clientHeight
  };
}
let isTransitioning = false;
function handleClick(clientX, clientY) {
  if (isTransitioning) return;
  const rect = canvas.getBoundingClientRect();
  const clickX = clientX - rect.left, clickY = clientY - rect.top;
  const viewProj = getViewProjMatrix();
  let best = null, bestDist = Infinity;
  for (const m of markerEntities) {
    const s = projectToScreen(m.core.getPosition(), viewProj);
    if (!s) continue;
    const d = Math.hypot(s.x - clickX, s.y - clickY);
    if (d < bestDist) { bestDist = d; best = m; }
  }
  const threshold = Math.min(canvas.clientWidth, canvas.clientHeight) * 0.35;
  if (best && bestDist < threshold) goTo(nodesById.get(best.targetId));
}

// --- Transition : vol caméra en ligne droite dans le splat ------------------
const TRANSITION_MS = 1500;
function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

function goTo(targetNodeData) {
  if (isTransitioning) return;
  isTransitioning = true;

  const fromPos = pos3(currentNodeData);
  const toPos = pos3(targetNodeData);

  panoEntity.enabled = false;
  for (const m of markerEntities) { m.core.enabled = false; m.halo.enabled = false; }
  splatEntity.enabled = true;
  currentRoomEl.textContent = `${currentNodeData.id} → ${targetNodeData.id}…`;

  const start = performance.now();
  function step() {
    const t = Math.min(1, (performance.now() - start) / TRANSITION_MS);
    camera.setPosition(new Vec3().lerp(fromPos, toPos, easeInOutCubic(t)));
    if (t < 1) {
      requestAnimationFrame(step);
    } else {
      splatEntity.enabled = false;
      showSphere(targetNodeData);
      isTransitioning = false;
    }
  }
  requestAnimationFrame(step);
}

showSphere(tourData.spheres[0]);
if (!failedAssets.length) loadingScreen.classList.add('hidden');
