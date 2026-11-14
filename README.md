# AriadnaCraft — Voxel Multiplayer 3D Online + WebXR + Multi-IA

Juego voxel 3D **100% online** estilo Minecraft para **celular (táctil), PC (sin depender de la rueda del mouse) y WebXR / VR estereoscópico**, construido con **Three.js**, **Cloudflare Workers + Durable Objects SQLite (WebSockets)** y una cascada de **IAs gratuitas** (Groq, Gemini Flash y Mistral Codestral) que construyen estructuras en tiempo real dentro de las salas.

## Características principales

- **100% Online y Compartible por Link**: Abrís una sala con `?room=mi-sala` y compartís el link para jugar al instante desde celular o PC.
- **Controles pensados para móvil y PC sin scroll**:
  - **Móvil**: joystick táctil izquierdo, giro de cámara arrastrando en la pantalla derecha, botones grandes de **Saltar**, **Picar**, **Poner** y barra rápida de bloques tocables.
  - **PC**: `WASD` + mouse (Pointer Lock), `Click izq` picar, `Click der` / `E` poner bloque, teclas `1..9` y botones `<` / `>` / clic directo para cambiar de bloque sin usar rueda del mouse.
  - **WebXR / VR**: botón `VR` nativo cuando el navegador/visor soporta WebXR, más modo **VR Estéreo** fallback para celulares/Cardboard.
- **Arquitecto Multi-IA en vivo**:
  - Pedile al asistente del juego (ej. *"haceme una cabaña con luz"* o *"armá un puente sobre el agua"*) y la cascada consulta automáticamente modelos gratuitos configurados en secrets:
    1. **Groq** (`openai/gpt-oss-120b` con `reasoning_effort: "low"`, `qwen/qwen3.8-27b`, `openai/gpt-oss-20b`)
    2. **Google Gemini Free** (`gemini-flash-lite-latest`, `gemini-3.1-flash-lite-preview`, `gemini-3-flash-preview`)
    3. **Mistral** (`codestral-latest`)
- **Persistencia real por sala**: Cloudflare Durable Objects + SQLite almacena los cambios de bloques por sala y retransmite posiciones de avatares, bloques y construcciones IA vía WebSockets Hibernation API.

## Desarrollo y Pruebas

Requiere Node 20+:

```bash
npm test
```

## Despliegue

El repositorio incluye `.github/workflows/deploy.yml` usando `cloudflare/wrangler-action@v3`:

1. Configurar secrets en GitHub Actions: `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID`.
2. Configurar secrets del Worker en Cloudflare: `GROQ_API_KEY_1`, `GROQ_API_KEY_2`, `GEMINI_API_KEY_1`, `GEMINI_API_KEY_2`, `MISTRAL_API_KEY`.
3. Hacer `git push origin main`.
