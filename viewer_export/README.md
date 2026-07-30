# Visite virtuelle 360° — Insta360 X5 / Agisoft Metashape / LichtFeld Studio / Houdini / PlayCanvas

Visualiseur web de visite virtuelle : panoramas 360° connectés par des
hotspots, avec transition en vol caméra à travers un modèle de gaussian
splatting (`.sog`, format LichtFeld/PlayCanvas SuperSplat) entre deux points.

**État : première version fonctionnelle et alignée.** Reste à faire : passe
design (voir section 6).

## 1. Pipeline de données

```
Insta360 X5 (photos 360°)
  -> Agisoft Metashape (alignement, point cloud)
  -> script d'export perso (metashapepro_360_lfs.py)
       -> transforms.json (poses caméra)
       -> pointcloud.ply (nuage de points, repère RAW Metashape)
  -> LichtFeld Studio
       -> Model.sog (gaussian splat)
  -> Houdini (/obj/virtual_tour_QC)
       -> calcul du graphe de visibilité entre sphères (VEX, contre pointcloud.ply)
       -> lecture directe de la géométrie Houdini (position + orientation
          right/up/N) -> hotspots.json
  -> viewer web (ce dossier)
```

Point important : **toutes les corrections de repère/orientation se font
dans Houdini**, pas dans le viewer. Le node `export_hotspots_json` lit la
géométrie Houdini *telle qu'elle est* (après vos transforms) et l'exporte —
le viewer affiche ces données sans recalcul. Si quelque chose doit changer
(alignement, hauteur des caméras, etc.), ça se fait dans Houdini puis on
recuit `export_hotspots_json`.

## 2. Installation / lancement

Placer les 4 fichiers de ce dossier (`index.html`, `main.js`, `style.css`,
`README.md`) dans le dossier `viewer_export`, à côté de `hotspots.json`.
Arborescence attendue :

```
LichtFeld_Export01\
├── images\                 (photos 360° sources)
├── Model.sog                (gaussian splat)
├── model.glb                 (mesh sphère haute résolution, cf. §4)
├── transforms.json
├── pointcloud.ply
└── viewer_export\
    ├── hotspots.json        (généré par Houdini)
    ├── index.html
    ├── main.js
    └── style.css
```

`hotspots.json` référence `images/`, `Model.sog` et `model.glb` via des
chemins relatifs `../...`. Le serveur HTTP local doit donc être lancé **depuis
`LichtFeld_Export01`** (le dossier parent), pas depuis `viewer_export` —
`python -m http.server` refuse de servir des fichiers situés au-dessus de son
propre dossier :

```bash
cd LichtFeld_Export01
python -m http.server 8080
```

Puis ouvrir : `http://localhost:8080/viewer_export/`

## 3. Utilisation

- **Glisser la souris** : regarder autour de soi
- **Cliquer** sur un point lumineux (hotspot) ou dans sa direction générale
  (~35% du plus petit côté de l'écran de tolérance) : lance un **vol caméra
  en ligne droite dans `Model.sog`** vers la sphère suivante
- **Icône ⚙** : panneau de calibration en direct —
  - `Miroir U` : inverse la texture horizontalement
  - `Yaw / Pitch / Roll suppl.` : rotation additionnelle appliquée après (ou
    avant, selon la case) la rotation de base (`rotation_matrix`)
  - `Roll caméra` : fait tourner la vue elle-même (utile si toute la scène
    semble "à l'envers" sans vouloir toucher aux données)
  - `Copier les réglages` : copie les valeurs actuelles (JSON) dans le
    presse-papiers

## 4. Décisions techniques (pourquoi c'est fait comme ça)

Ce projet a demandé beaucoup d'itération pour régler l'orientation des
panoramas et deux artefacts de rendu classiques. Résumé pour ne pas perdre
le fil :

- **Repère des positions** : `pos3()` utilise les positions brutes de
  `hotspots.json`, sans transformation côté JS — toute correction de repère
  se fait dans Houdini avant export (voir §1).
- **Réglage de rotation validé** : `mirrorU: true, yaw: 180` (valeurs par
  défaut dans `main.js`). Trouvé empiriquement en comparant une sphère
  texturée au `Model.sog` directement dans Houdini.
- **Couture UV (ligne verticale sur l'image)** : les textures des panoramas
  sont chargées "à la main" (pas via le système Asset de PlayCanvas) et
  **rembourrées** de 48px de chaque côté (`PAD_PIXELS`) — on duplique le bord
  droit avant le bord gauche et inversement — avant d'être uploadées au GPU.
  Ça évite que le filtrage mipmap/anisotrope mélange les deux bords de
  l'image à la frontière U=0/U=1.
- **Zigzag/moiré (surtout visible près des pôles)** : anisotropie GPU
  poussée au maximum (`tex.anisotropy = device.maxAnisotropy`) + résolution
  de la sphère suffisante. Un mesh trop grossier (48×32 segments) recréait
  l'artefact malgré l'anisotropie.
- **Mesh de la sphère (`model.glb`)** : après plusieurs itérations sur un
  mesh équirectangulaire fait main (`buildEquirectMesh` dans `main.js`, gardé
  en fallback), la solution retenue est le mesh sphère exporté depuis un
  projet PlayCanvas officiel (`PANO_MESH_SOURCE = 'glb'` dans `main.js`),
  chargé comme asset `container`. Si `model.glb` est absent/introuvable, le
  code retombe automatiquement sur le mesh fait main.
- **Note FBX** : `sphere.fbx` n'est pas utilisable tel quel — les navigateurs
  et le moteur PlayCanvas au runtime ne parsent pas le FBX directement (seul
  l'éditeur PlayCanvas sait le convertir). D'où l'usage de `model.glb`.

## 5. Régénérer `hotspots.json` après modification dans Houdini

Dans `/obj/virtual_tour_QC` :
`pointcloud_src` + `sphere1`/`copytopoints1` (proxy) → `cams_and_hotspots`
(lecture de `hotspots.json`, ajout des attributs `right`/`up`/`N`/`orient`) →
`transform1` → `attribwrangle5` (test de visibilité, tableaux `yes_visible`/
`no_visible`) → `out` → `export_hotspots_json` (réécrit
`viewer_export/hotspots.json` **directement depuis la géométrie du node
`out`**).

Après tout ajustement (rayon d'influence, correction manuelle de
`yes_visible`, transform de repère), recuire `export_hotspots_json`. Le
viewer web n'a rien d'autre à faire : il relit ce fichier à chaque ouverture.

## 6. Prochaines étapes

- Passe design (apparence des hotspots, UI, transitions) — skills à venir.
- Repère de `transforms.json`/`pointcloud.ply` à figer proprement dès le
  départ dans un futur export Agisoft (scène alignée), pour ne plus dépendre
  des corrections actuelles dans Houdini.
- Chargement à la demande des textures (actuellement tout est chargé au
  démarrage — 18 images en 5888×2944 + rembourrage, potentiellement lourd
  selon la machine).
