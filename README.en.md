# wvmTool

[日本語](README.md) | [English](README.en.md) | [中文](README.zh.md) | [한국어](README.ko.md) | [Español](README.es.md) | [Français](README.fr.md)

![alt text](pics/top.png)

This is a browser-contained video mosaic editing web application.

## Available from the following URL

https://dikmri.github.io/wvmTool/

## Compatible browsers

- Google Chrome latest version (recommended)
- Microsoft Edge latest version
-Latest version of Firefox
- Safari: Some functions may be limited (WebCodecs/WebGL2 compatibility)

## Main features

- Drag and drop loading of MP4 videos
- Manage multiple rectangular mosaic tracks independently
- Draw, move, and resize the mosaic area using corner handles
- Rotate mosaic range (Q/E key, reset with R)
- Keyframe-based mosaic position, size, rotation, show/hide animation
- Real-time mosaic preview using WebGL2 (rotation supported)
- Fast frame decoding/encoding with WebCodecs
- Export MP4 with audio (automatically inherits the bitrate of the original video)
- During playback, you can hide the overlay border and check the pure mosaic
- Display the shortcut list from the "How to use" button on the screen
- **Multilingual support**: Japanese / English / Chinese / 한국어 / Español / Français (switch with header)

## How to use

1. Drag and drop the MP4 video to the viewport (or click to select file)
2. Click "+ Add" in the tools panel to create a mosaic track
- Automatically switches to drawing mode when added
3. Draw the mosaic area by dragging on the viewport
4. Add keyframes at desired positions while seeking on the timeline (K key)
5. If necessary, switch to selection mode, drag the rectangle to move it, and use the corner handles to resize it.
6. Click "Start export" in the export panel

### Mosaic track operations

- **Multiple Tracks**: If you add multiple tracks, each track will have its own independent mosaic area.
- **●/○ button**: Enable/disable track
- **× Delete**: Delete the selected track
- **Mosaic size**: Adjust the granularity of the mosaic with the slider (5 to 80px)

### Keyboard shortcuts

| Key | Operation |
|------|------|
| Space | Play/Stop |
| ArrowLeft | Go back one frame |
| ArrowRight | Forward 1 frame |
| Shift+← / → | Move to first/last frame |
| K | Add keyframe at current position |
| Delete | Delete selected keyframe |
| Q | Rotate the mosaic range 5 degrees counterclockwise |
| E | Rotate the mosaic range 5° clockwise |
| R | Reset rotation of mosaic range (0°) |
| H | Record mosaic display/hide as a key frame |
| I | Add new mosaic track |
| N | Adjust the display size to fit the screen (zoom reset) |
| Wheel | Zoom in/zoom out |

> During playback, the border of the mosaic range is hidden and you can only see the mosaic effect.

### Export settings

| Settings | Contents |
|------|------|
| Codec | Auto (H.264 priority) / H.264 / VP9 / AV1 |
| Image quality | Highest image quality (quantizer 16) / High image quality (22) / Standard (28) / Low image quality (35). Default is "High quality" |
| Suffix | String to be appended to the output file name (default: `_mosaic`) |

In H.264, quality is controlled using VBR (Variable Bitrate). Automatically detects the bitrate of the original video and multiplies it by the quality setting multiplier to determine the target bitrate (high quality = same as the original video, highest quality = 1.5x, standard = 0.65x, low quality = 0.35x). FPS is automatically detected from the original video. Audio is passed through from the original video.

If you add a mosaic track and draw a rectangle in drawing mode, it will automatically switch to selection mode after drawing is complete. The mosaic range can also be specified outside the video range.

## Privacy/Security

**Video files are not uploaded to the server. ** All processing is completed within the user's browser. There is no communication to external APIs.

## Known limitations

- Some functions may be limited in Safari depending on WebCodecs/WebGL2 compatibility.
- Very long and high resolution videos may run out of memory.
- Export requires browser's WebCodecs API

## Technical configuration

| Layer | Technology |
|----------|------|
| UI Framework | Svelte 5 + TypeScript |
| Build tools | Vite 6 |
| Video decoding/encoding | WebCodecs API |
| Rendering | WebGL2 (rotation compatible mosaic shader) |
| Canvas2D fallback | For environments that do not support WebGL2 (rotation supported) |
| Background processing | Web Worker + OffscreenCanvas |
| MP4 container analysis | mp4box.js |
| MP4 multiplex | mp4-muxer |
| Hosting | GitHub Pages |

## Performance Policy

- Do not have video frame data in the UI thread
- All heavy processing (decoding, encoding, mosaic application) is performed by Web Worker
- GPU mosaic processing using WebGL2 shader (up to 8 tracks simultaneously)
- Minimize impact on main thread using OffscreenCanvas
- Always `close()` VideoFrame after use to prevent memory leaks
- When exporting, all frames are not retained and processed sequentially

## Development method

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

## How to deploy

GitHub Actions automatically builds and deploys to GitHub Pages by pushing to the `main` branch.

For manual deployment:

```bash
npm run build
# dist/ ディレクトリの内容を GitHub Pages にデプロイ
```
