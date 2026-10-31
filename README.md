# BallisticPro

Calculadora balística profesional (armas de fuego y aire comprimido) que funciona **sin conexión**
como PWA instalable en iPhone y Android. Sin frameworks, sin CDNs.

## Probar localmente
```powershell
npm run serve        # http://localhost:8080
```

## Pruebas
```powershell
npm test                          # motor: regresión vs. motor original + física (32 pruebas)
node tests/dom-smoke.js           # arranque real de la app en jsdom (requiere: cd tests; npm i)
node tests/check-offline-assets.js  # todo lo precacheado existe
npm run bench                     # tiempos del solver
```

## Publicar (GitHub Pages, HTTPS)
1. Subir el repositorio y activar *Settings → Pages → Source: main → /root*.
2. Abrir la URL en el celular **con señal** una vez y usar *Agregar a pantalla de inicio*
   (iPhone: Safari → Compartir; Android: Chrome → Instalar app).
3. Verificar en **modo avión**: la app debe abrir y calcular.

Las reglas del proyecto están en `Documentos/reglas-proyecto.md`.
