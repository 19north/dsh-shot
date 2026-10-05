# dsh-shot — control de captura de pantalla para el compositor

> [English](./README.md) · [中文](./README-zh.md) · **Español** ·
> [Português](./README-pt.md) · [हिन्दी](./README-hi.md)
>
> Traducción **parcial**: la referencia completa es [README.md](./README.md); el registro de
> implementación y decisiones está en [DESIGN.md](./DESIGN.md). Los encabezados se mantienen en
> inglés para que las cinco versiones se puedan comparar.

Añade un botón de cámara junto a `＋` en el compositor de DeepSeek Harness, con dos opciones:
**captura directa** (toma toda la pantalla virtual de inmediato) y **ocultar esta ventana**
(oculta la ventana de DSH, captura y la restaura **exactamente** como estaba, incluso si estaba
minimizada).

## Requirements

- DeepSeek Harness `0.1.7` o posterior, perfil de escritorio/web.
- Windows: la captura usa PowerShell + Win32.
- Node `^22.19.0 || >=24.0.0`.
- **Sin dependencias de ejecución**: la mitad de host solo importa módulos `node:*`.

## Install

```sh
dsh plugin --profile <profile> add ./dsh-shot              # desde el código fuente
dsh plugin --profile <profile> add ./dsh-shot-0.1.0.tgz    # desde un tarball (pnpm pack)
```

Reinicia la aplicación: la revisión del bundle de cliente se calcula al arrancar, así que
recargar la página no basta.

## Use

1. Pulsa el botón de cámara junto a `＋` y elige una de las dos opciones.
2. La capa cubre la ventana: **arrastra un recuadro** para seleccionar una región.
3. Anota si quieres y confirma; la imagen entra en el borrador del compositor.

| Acción | Efecto |
|---|---|
| Arrastrar los **ocho tiradores** (esquinas y puntos medios) | Redimensiona desde ese tirador. |
| Arrastrar **dentro** del recuadro | Mueve el recuadro sin cambiar su tamaño. |
| **Flechas** del teclado | Ajusta un píxel; con **Shift**, diez. |
| **Clic derecho** / **Reelegir** | Descarta la selección y empieza de nuevo. |
| **Esc** / clic derecho | Retrocede un nivel (deshacer anotación → reelegir → salir). |

Herramientas: **rectángulo**, **flecha**, **texto** (haz clic en un punto, escribe y pulsa
**Enter**; **Esc** cancela; **doble clic edita** el texto existente), paleta de **ocho colores**,
**deshacer** y **reelegir**. El texto lleva una placa oscura translúcida para seguir legible
sobre cualquier fondo.

## How it fits together

| Mitad | Archivo | Se ejecuta en |
|---|---|---|
| Host | `lib/index.js` | Servidor de DSH; registra las rutas `/api/dsh-shot/*` y lanza `scripts/capture.ps1`. |
| Cliente | `lib/client.js` | Navegador; el botón del compositor y la capa de recorte/anotación. |
| Captura | `scripts/capture.ps1` | Proceso de PowerShell independiente; busca la ventana de DSH, la oculta/restaura y captura la pantalla virtual. |

La mitad de cliente se declara en `package.json` bajo `dsh.client` y se sirve desde
`/plugins/dsh-shot/client.js`.

## Known limitations

- **Solo Windows**: la captura usa PowerShell + Win32.
- La capa cubre la **ventana**, no la pantalla: la captura se escala para llenar la ventana, así
  que se recorta lo que no coincide con su proporción. Los monitores múltiples se tratan como una
  sola pantalla virtual y una ventana pequeña no alcanza todas sus esquinas.
- El modo ocultar hace desaparecer DSH entre 0,3 y 1,2 s aproximadamente.
- Rara vez el script de captura devuelve un fotograma casi vacío; repetir la captura funciona.

## Development

```sh
dsh-plugin-dev check --cwd .     # comprobaciones estáticas del contrato
dsh-plugin-dev verify --cwd .    # empaqueta e instala/arranca/desinstala en un DSH_HOME temporal
```

Las suites de regresión sin interfaz viven fuera del paquete (`dsh-screenshot-research/`).

## License

MIT.
