# Matiz Research — Home

Landing page estática de Matiz Research generada con Claude Design Canvas.

## Estructura

- `index.html` — página principal (originalmente `Matiz Research.dc.html`)
- `support.js` — runtime de Claude Design Canvas (carga React/ReactDOM/Babel desde CDN unpkg)
- `image-slot.js`, `glyph-portal.jsx` — componentes del canvas
- `logo-*.svg` — logos
- `maps.json` — datos auxiliares del canvas

## Desarrollo local

```bash
npx serve .
# o
python3 -m http.server 8000
```

Abrí `http://localhost:8000`.

> Necesita internet la primera vez para que `support.js` traiga React/ReactDOM/Babel desde `unpkg.com`.

## Deploy en Vercel

Es un sitio 100% estático, no necesita build.

1. Subí este repo a GitHub.
2. En Vercel: **Add New Project → Import** el repo.
3. Framework Preset: **Other**. Build Command: dejar vacío. Output Directory: `.` (o vacío).
4. Deploy.

## Deploy en Hostinger

Subir todos los archivos del repo (excepto `.git`, `README.md`, `.gitignore`) al directorio público (`public_html`) por FTP o el File Manager.
