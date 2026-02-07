<div align="center">

<img src="media/icon.png" alt="TractView Logo" width="128" height="128">

# TractView

**A VS Code Extension for 3D Tractography Visualization**

[![VS Code](https://img.shields.io/badge/VS%20Code-1.85%2B-blue?logo=visualstudiocode)](https://code.visualstudio.com/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Three.js](https://img.shields.io/badge/Three.js-WebGL-black?logo=threedotjs)](https://threejs.org/)

View tractography files (`.trk`, `.tck`, `.trx`) directly in VS Code with interactive 3D visualization powered by Three.js.

[Features](#features) • [Installation](#installation) • [Configuration](#configuration) • [Author](#author)

</div>

---

## 👤 Author

**Marco Tagliaferri** — *PhD Candidate in Neuroscience*
🏛️ [Center for Mind/Brain Sciences (CIMeC)](https://www.cimec.unitn.it/), University of Trento, Italy

[![Email](https://img.shields.io/badge/Email-marco.tagliaferri%40unitn.it-D14836?style=flat&logo=gmail&logoColor=white)](mailto:marco.tagliaferri@unitn.it)
[![Email](https://img.shields.io/badge/Email-marco.tagliaferri93%40gmail.com-D14836?style=flat&logo=gmail&logoColor=white)](mailto:marco.tagliaferri93@gmail.com)
[![GitHub](https://img.shields.io/badge/GitHub-marcotag93-181717?style=flat&logo=github)](https://github.com/marcotag93)

---

## ✨ Features

<table>
<tr>
<td width="50%">

### Multi-Format Support
- **TRK** — TrackVis format
- **TCK** — MRtrix format
- **TRX** — Modern ZIP-based format

</td>
<td width="50%">

### Interactive Visualization
- WebGL-powered 3D rendering
- Orbit, zoom, and pan controls
- Real-time brightness adjustment
- Dark/light background toggle

</td>
</tr>
<tr>
<td>

### Rendering Modes
- **Lines** — Fast wireframe rendering
- **Tubes** — High-quality 3D tubes

</td>
<td>

### Coloring Modes
- **Direction** — RGB based on orientation (X=red, Y=green, Z=blue)
- **Length** — Color gradient by streamline length
- **Scalar** — Color by per-point scalar values (TRK only)

</td>
</tr>
<tr>
<td>

### Smart Performance
- Automatic skip sampling for large datasets
- Configurable streamline limits
- Optimized GPU rendering

</td>
<td>

### Export Options
- **Screenshot** — Save current view as PNG
- **Download** — Export original file to new location

</td>
</tr>
</table>

---

## 📦 Installation

### From Source

```bash
# Clone the repository
git clone https://github.com/marcotag93/tractview.git
cd tractview

# Install dependencies
npm install

# Compile the extension
npm run compile
```

Press `F5` in VS Code to launch the Extension Development Host.

### From VSIX

1. Download the `.vsix` release file
2. Open VS Code → Extensions (`Ctrl+Shift+X`)
3. Click `...` → **Install from VSIX...**
4. Select the downloaded file

---

## ⚙️ Configuration

Access settings via `File → Preferences → Settings → Extensions → TractView`

| Setting | Default | Description |
|---------|---------|-------------|
| `tractview.maxStreamlines` | `100000` | Maximum streamlines to render |
| `tractview.skipThreshold` | `5000` | Threshold for enabling skip sampling |
| `tractview.backgroundColor` | `#2d2d2d` | Default background color |
| `tractview.defaultRenderMode` | `lines` | Initial render mode |
| `tractview.tubeRadius` | `0.3` | Tube radius in tube mode |

---

## 📂 Supported Formats

| Format | Extension | Description |
|--------|-----------|-------------|
| **TrackVis** | `.trk` | Binary format with 1000-byte header |
| **MRtrix** | `.tck` | Text header + binary float triplets |
| **TRX** | `.trx` | ZIP archive with JSON metadata |

---

## 📄 License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- [Three.js](https://threejs.org/) — Powerful 3D rendering library
- [TrackVis](http://trackvis.org/) — TRK format specification
- [MRtrix3](https://www.mrtrix.org/) — TCK format specification
- [TRX Specification](https://github.com/tee-ar-ex/trx-spec) — TRX format specification

---
