# wvmTool

[日本語](../README.md) | [English](README.en.md) | [中文](README.zh.md) | [한국어](README.ko.md) | [Español](README.es.md) | [Français](README.fr.md)

![alt text](../pics/top.png)

Il s'agit d'une application Web d'édition de mosaïque vidéo contenue dans un navigateur.

## Disponible à partir de l'URL suivante

https://dikmri.github.io/wvmTool/

## Navigateurs compatibles

- Dernière version de Google Chrome (recommandée)
- Dernière version de Microsoft Edge
-Dernière version de Firefox
- Safari : Certaines fonctions peuvent être limitées (compatibilité WebCodecs/WebGL2)

## Principales fonctionnalités

- Chargement par glisser-déposer des vidéos MP4
- Gérer plusieurs pistes de mosaïque rectangulaires indépendamment
- Dessinez, déplacez et redimensionnez la zone de mosaïque à l'aide des poignées d'angle
- Rotation de la plage mosaïque (touche Q/E, réinitialisation avec R)
- Position, taille, rotation de la mosaïque basée sur les images clés, animation afficher/masquer
- Aperçu de la mosaïque en temps réel à l'aide de WebGL2 (rotation prise en charge)
- Décodage/encodage rapide des images avec WebCodecs
- Exporter MP4 avec audio (hérite automatiquement du débit binaire de la vidéo originale)
- Pendant la lecture, vous pouvez masquer la bordure de superposition et vérifier la mosaïque pure
- Afficher la liste des raccourcis à partir du bouton "Comment utiliser" sur l'écran
- **Support multilingue** : Japonais / Anglais / Chinois / 한국어 / Español / Français (switch avec en-tête)

## Comment utiliser

1. Faites glisser et déposez la vidéo MP4 dans la fenêtre (ou cliquez pour sélectionner le fichier)
2. Cliquez sur "+ Ajouter" dans le panneau d'outils pour créer une piste mosaïque
- Passe automatiquement en mode dessin une fois ajouté
3. Dessinez la zone de mosaïque en faisant glisser sur la fenêtre
4. Ajoutez des images clés aux positions souhaitées lors de la recherche sur la timeline (touche K)
5. Si nécessaire, passez en mode sélection, faites glisser le rectangle pour le déplacer et utilisez les poignées d'angle pour le redimensionner.
6. Cliquez sur "Démarrer l'exportation" dans le panneau d'exportation

### Opérations sur les pistes mosaïques

- **Plusieurs pistes** : Si vous ajoutez plusieurs pistes, chaque piste aura sa propre zone de mosaïque indépendante.
- **Touche ●/○** : Activer/désactiver la piste
- **× Supprimer** : Supprimer la piste sélectionnée
- **Taille de la mosaïque** : Ajustez la granularité de la mosaïque avec le curseur (5 à 80px)

### Raccourcis clavier

| Clé | Opération |
|------|------|
| Espace | Jouer/Arrêter |
| FlècheGauche | Revenir en arrière d'une image |
| FlècheDroite | Avancer d'une image |
| Maj+← / → | Passer à la première/dernière image |
| K | Ajouter une image clé à la position actuelle |
| Supprimer | Supprimer l'image clé sélectionnée |
| Q | Faites pivoter la plage de la mosaïque de 5 degrés dans le sens inverse des aiguilles d'une montre |
| E | Faites pivoter la plage de la mosaïque de 5° dans le sens des aiguilles d'une montre |
| R | Réinitialiser la rotation de la plage de mosaïque (0°) |
| H | Enregistrer l'affichage/masquage de la mosaïque en tant qu'image clé |
| Je | Ajouter une nouvelle piste mosaïque |
| N | Ajuster la taille de l'affichage à l'écran (réinitialisation du zoom) |
| Roue | Zoom avant/zoom arrière |

> Pendant la lecture, la bordure de la plage de mosaïque est masquée et vous ne pouvez voir que l'effet mosaïque.

### Paramètres d'exportation

| Paramètres | Contenu |
|------|------|
| Codecs | Auto (priorité H.264) / H.264 / VP9 / AV1 |
| Qualité des images | Qualité d'image la plus élevée (quantificateur 16) / Qualité d'image élevée (22) / Standard (28) / Qualité d'image faible (35). La valeur par défaut est "Haute qualité" |
| Suffixe | Chaîne à ajouter au nom du fichier de sortie (par défaut : `_mosaic`) |

En H.264, la qualité est contrôlée à l'aide du VBR (Variable Bitrate). Détecte automatiquement le débit binaire de la vidéo originale et le multiplie par le multiplicateur de réglage de qualité pour déterminer le débit binaire cible (haute qualité = identique à la vidéo originale, qualité la plus élevée = 1,5x, standard = 0,65x, faible qualité = 0,35x). Le FPS est automatiquement détecté à partir de la vidéo originale. L'audio est transmis à partir de la vidéo originale.

Si vous ajoutez une piste mosaïque et dessinez un rectangle en mode dessin, il passera automatiquement en mode sélection une fois le dessin terminé. La plage mosaïque peut également être spécifiée en dehors de la plage vidéo.

## Confidentialité/Sécurité

**Les fichiers vidéo ne sont pas téléchargés sur le serveur. ** Tout le traitement est effectué dans le navigateur de l'utilisateur. Il n'y a aucune communication avec les API externes.

## Limites connues

- Certaines fonctions peuvent être limitées dans Safari en fonction de la compatibilité WebCodecs/WebGL2.
- Les vidéos très longues et haute résolution peuvent manquer de mémoire.
- L'exportation nécessite l'API WebCodecs du navigateur

## Configuration technique

| Couche | Technologie |
|----------|------|
| Cadre d'interface utilisateur | Svelte 5 + TypeScript |
| Construire des outils | Vite 6 |
| Décodage/encodage vidéo | API WebCodecs |
| Rendu | WebGL2 (shader mosaïque compatible avec la rotation) |
| Solution de secours Canvas2D | Pour les environnements qui ne prennent pas en charge WebGL2 (rotation prise en charge) |
| Traitement en arrière-plan | Travailleur Web + OffscreenCanvas |
| Analyse du conteneur MP4 | mp4box.js |
| Multiplex MP4 | multiplexeur mp4 |
| Hébergement | Pages GitHub |

## Politique de performances

- Ne pas avoir de données d'image vidéo dans le fil de l'interface utilisateur
- Tous les traitements lourds (décodage, encodage, application mosaïque) sont effectués par Web Worker
- Traitement de la mosaïque GPU à l'aide du shader WebGL2 (jusqu'à 8 pistes simultanément)
- Minimiser l'impact sur le thread principal en utilisant OffscreenCanvas
- Toujours `close()` VideoFrame après utilisation pour éviter les fuites de mémoire
- Lors de l'exportation, toutes les images ne sont pas conservées et traitées séquentiellement

## Méthode de développement

```bash
# 依存関係のインストール
npm install

# 開発サーバー起動
npm run dev

# プロダクションビルド
npm run build

# ビルドのプレビュー
npm run preview
```

## Comment déployer

GitHub Actions se construit et se déploie automatiquement sur les pages GitHub en poussant vers la branche « principale ».

Pour un déploiement manuel :

```bash
npm run build
# dist/ ディレクトリの内容を GitHub Pages にデプロイ
```
