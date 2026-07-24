# molaria-agent-service

Nucleo agentico de [MolarIA](https://github.com/) extraido de n8n: el loop de
Claude (tool-use) y la ejecucion de las herramientas `consultar_disponibilidad`
y `crear_hold`. n8n sigue siendo el pegamento (webhook, verificacion de firma,
lookup de tenant/conversacion, persistencia de historial, envio del mensaje de
WhatsApp) y llama a este servicio con una unica peticion HTTP por turno de
conversacion.

## Por que existe

En n8n el loop estaba desenrollado a mano en 3 nodos Claude (`Ejecución Claude
Agente` / `Claude 2` / `Claude 3`) con un bug real de enrutado entre ellos, un
limite duro de 2 llamadas a herramienta por turno, y el algoritmo de huecos
(`Huecos`) sin ningun test posible. Aqui el loop es un bucle real, con tipos y
tests.

## Endpoint

`POST /agent/run` (ver `src/types.ts` para el contrato exacto de entrada/salida).

Autenticacion: header `Authorization: Bearer <AGENT_SERVICE_SECRET>`. En n8n,
configurar como una credencial "HTTP Header Auth" (igual que `meta2` para
WhatsApp) — nunca como expresion `$env` dentro de un nodo, que en la instancia
de MolarIA esta bloqueado tanto en nodos Code como en campos de expresion de
Set.

## Desarrollo

```bash
npm install
cp .env.example .env   # rellenar valores reales
npm run dev            # servidor con reload en caliente
npm test                # tests del algoritmo de huecos (funcion pura, sin red)
npm run build && npm start   # build de produccion
```

## Despliegue

Railway, mismo proyecto donde ya corre n8n. Variables de entorno: ver
`.env.example`. `GOOGLE_SERVICE_ACCOUNT_JSON` es el JSON completo de la cuenta
de servicio de Google Calendar en una sola linea.

## Migracion

Pensado para cortar sobre n8n de forma incremental: anadir un flag por
clinica (ej. `usa_servicio_agente` en la tabla `Clientes`) y decidir en el
workflow de n8n si el turno se resuelve con el subgrafo antiguo o con una
llamada a este servicio, clinica a clinica.
