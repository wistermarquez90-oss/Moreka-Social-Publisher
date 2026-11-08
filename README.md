# Moreka Shop · revisión y planeación de contenido

Aplicación full-stack para preparar y autorizar contenido de Moreka Shop. **Kimi sigue siendo el entorno predeterminado**. El código también incluye adaptadores para una migración futura a un servidor Docker con MySQL y almacenamiento local o S3/Spaces.

## Reglas operativas

- Shopify se consulta por productos recientes y cada producto se revalida antes de generar su escena.
- Solo se aceptan productos activos y publicados, con fecha de publicación e imagen verificables. Borradores, archivados, eliminados, no publicados o estados desconocidos quedan fuera.
- Los productos usados anteriormente no se repiten automáticamente.
- Un lote nuevo contiene **7 productos + 3 editoriales**. Los editoriales ocupan las posiciones **3, 7 y 10**.
- Cada fila comparte concepto y preset `moreka-aire`. La marca usa `#0FABE2`, `#98CDEF`, `#333E48`, fondos claros e Inter.
- Se solicita **una escena Gemini por producto**. La escena fuente se conserva para recomponer textos sin otra llamada de IA.
- Las tres características, el logo y el CTA se componen localmente, nunca como texto generado dentro de la escena.
- El sorteo mensual requiere premio principal y premio para la persona etiquetada. Sin ambos, la posición 10 es educativa.
- Autorizar una publicación individual **no publica ni programa** y no exige autorizar su lote completo. El propietario debe crear una entrada en el calendario.
- Cada entrada usa una sola fecha para las redes incluidas. Antes del envío se revalida Shopify y cada red guarda su propio resultado.
- El video es opcional para imágenes e historias: sin video, TikTok y YouTube quedan excluidos automáticamente. Los Reels sí requieren un enlace HTTPS público directo a un archivo de video. No se aceptan páginas, carpetas ni videos simulados.
- Los textos automáticos no añaden precios, envío gratis ni garantía. Esas afirmaciones requieren verificación vigente.
- Solo el propietario puede editar, cargar, revisar y autorizar.

## Estructura

- `src/components/review/`: panel de productos, plan editorial y carga de recursos.
- `api/review-router.ts`: revisión de productos y autorización conjunta.
- `api/editorial-router.ts`: editoriales y premios mensuales.
- `api/services/content-worker.ts`: preparación reanudable e idempotente.
- `api/services/shopify.ts`: catálogo público o Admin GraphQL de solo lectura.
- `api/services/gemini.ts`: exactamente una escena por llamada de producto.
- `api/services/composition.ts`: exportación JPEG 1080 × 1350 en el worker.
- `api/services/svg-composition.ts`: recomposición de características sin nueva IA.
- `api/services/object-storage.ts`: adaptadores Kimi, local y S3.
- `api/services/auth.ts`: autenticación externa del propietario.
- `scripts/`: migración, worker, respaldo y exportación de archivos.

## Desarrollo y operación actual en Kimi

La configuración existente usa `AUTH_DRIVER=kimi` y `STORAGE_DRIVER=kimi` de forma predeterminada. No es necesario cambiar el `.env` actual.

```bash
npm install
npm run check
npm test
npm run dev
```

La migración incremental es segura de repetir y no elimina tablas ni columnas:

```bash
npm run db:content-migration
npm run db:publishing-migration
```

El worker no se ejecuta al iniciar el panel. Para una corrida manual, con las variables de Shopify y Gemini configuradas en el entorno protegido:

```bash
npm run worker
# Omitir la compuerta de 72 horas, sin omitir elegibilidad ni duplicados:
npm run worker -- --force
```

Una ejecución diaria tiene una clave única. Si un lote queda incompleto, el worker reutiliza las escenas fuente ya guardadas. Si ya está completo, informa que espera revisión y no crea otro lote.

## Preparar un servidor externo con Docker

### 1. Configurar secretos en el servidor

Copia `.env.external.example` como `.env.external` en el servidor. No lo subas a GitHub. Completa como mínimo:

- `APP_SECRET`: cadena aleatoria larga para sesiones.
- `MYSQL_PASSWORD` y `MYSQL_ROOT_PASSWORD`.
- `OWNER_EMAIL` y `OWNER_PASSWORD_HASH`.
- `PUBLIC_APP_URL`: dominio HTTPS del panel.
- `GEMINI_API_KEY` para el worker.
- Shopify público, o `SHOPIFY_MODE=admin` con un token de solo lectura guardado únicamente en el servidor.

Genera localmente el hash de la contraseña; no uses la contraseña como valor de `OWNER_PASSWORD_HASH`:

```bash
node scripts/hash-owner-password.mjs
```

El resultado tiene el formato `scrypt$<sal>$<hash>`. La autenticación externa crea o actualiza únicamente la cuenta propietaria después de validar esas credenciales.

### 2. Crear una instalación nueva y aislada

Usa un proyecto Compose propio para que la red, los contenedores y los volúmenes no se mezclen con otras aplicaciones del Droplet. El panel publica el puerto `4377` por defecto; cámbialo con `MOREKA_HTTP_PORT` en `.env.external` si ya está ocupado. MySQL permanece solo en la red interna.

```bash
docker compose -p moreka-social --env-file .env.external up -d db
docker compose -p moreka-social --env-file .env.external --profile setup run --rm setup
docker compose -p moreka-social --env-file .env.external up -d app
docker compose -p moreka-social --env-file .env.external exec app npm run db:content-migration
docker compose -p moreka-social --env-file .env.external exec app npm run db:publishing-migration
```

No uses `docker system prune`, `docker compose down -v` ni nombres de proyectos de otras aplicaciones. `setup` es solo para inicializar la base nueva y aislada. Para actualizaciones posteriores usa `db:content-migration`; no restaures ni ejecutes `db:push` sobre datos de producción.

### 3. Migrar datos existentes, cuando se decida

1. Detén temporalmente las escrituras en el origen y haz un respaldo completo de MySQL.
2. Restaura ese respaldo en el volumen `mysql-data` del nuevo servidor.
3. Exporta los archivos de Kimi desde el entorno actual:

   ```bash
   npm run storage:export-kimi
   ```

   El resultado conserva rutas como `moreka/<producto>/...` en `var/kimi-storage-export`.

4. Copia ese árbol al volumen `moreka-files`, dentro de `/app/var/storage`.
5. Ejecuta `npm run db:content-migration` en el nuevo servidor.
6. Verifica conteos de productos, textos y recursos, inicia sesión como propietario y abre una muestra de imágenes antes de cambiar el dominio.

No modifiques las claves `storageKey` al trasladar archivos. Las URLs firmadas se generan de nuevo y no forman parte de la migración.

### 4. Programar el worker y los respaldos

`deploy/moreka-content.cron` incluye una llamada diaria; la compuerta interna permite preparar un lote nuevo solo después de 72 horas. Ajusta rutas, instala el archivo en `/etc/cron.d/` y habilita el perfil del worker:

```bash
docker compose run --rm worker
```

El respaldo guarda MySQL y archivos durante 14 días:

```bash
PROJECT_DIR=/opt/moreka ./scripts/backup-external.sh
```

Guarda copias fuera del Droplet. Un volumen local y sus respaldos no sustituyen una copia externa.

### 5. Spaces o S3 opcional

Para usar Spaces/S3 en vez del volumen local, configura `STORAGE_DRIVER=s3`, región, endpoint, bucket, prefijo y credenciales en `.env.external`. La aplicación sigue guardando solamente claves. No actives esta opción antes de copiar y verificar los objetos existentes con el mismo prefijo.

## Shopify

- `SHOPIFY_MODE=public`: el catálogo público actúa como filtro de productos publicados; la revalidación usa la ficha pública individual.
- `SHOPIFY_MODE=admin`: GraphQL consulta `status:ACTIVE` y `published_status:published`, ordenado por creación descendente.
- El flujo necesita lectura de productos (`read_products`). No requiere escritura, clientes ni órdenes. `read_inventory` es opcional y no se usa.

## Calendario, empresas y conexiones

- `/calendario` cambia de lote, elige piezas autorizadas, formato y una fecha única para todas las redes activadas. Ofrece vista mensual en escritorio y agenda en móvil.
- `/configuracion` crea y selecciona empresas, cambia logotipo, variante clara, colores, zona horaria y días de retención sin editar código. Los lotes, calendarios y conexiones se consultan por empresa activa.
- El flujo activo usa **Instagram, Facebook, TikTok y YouTube**. LinkedIn se conserva únicamente en registros históricos y no aparece para nuevas programaciones.
- La opción recomendada es **Aplicación oficial**: cada empresa guarda el ID y secreto de su app en `/configuracion`, registra la URL de redirección mostrada y autoriza la cuenta en el sitio oficial. Los secretos y tokens se cifran con AES-256-GCM y nunca regresan al navegador. El estado OAuth está firmado, expira a los diez minutos y queda vinculado al propietario y a la empresa.
- Meta usa Facebook Login para localizar la Página y, en Instagram, la cuenta profesional vinculada. TikTok requiere Login Kit, Content Posting API, Direct Post y `video.publish`; el dominio del video debe estar verificado. YouTube requiere YouTube Data API v3 y un cliente OAuth web con `youtube.upload` y `youtube.readonly`.
- TikTok y YouTube permiten elegir privacidad de prueba al programar. Usa `SELF_ONLY` y `private` hasta completar las aprobaciones. TikTok no confirma publicación al aceptar el video: el worker consulta el estado hasta `PUBLISH_COMPLETE`. No se reenvía un resultado ambiguo.
- Como alternativa, cada red admite un endpoint HTTPS de Make, Zapier o conector propio. El botón **Probar conexión** envía `type: connection.test`; para confirmar una publicación mediante webhook se exige JSON `{ "published": true, "externalPostId": "…", "externalUrl": "…" }`. Un simple «aceptado» no se presenta como publicación confirmada.
- El envío nativo utiliza las APIs oficiales; el webhook usa `type: publication.publish`. Ambos incluyen o consumen red, formato, textos, imagen y video. Las redes se procesan con `Promise.allSettled` en la misma corrida; un fallo parcial queda visible y no se reintenta automáticamente para evitar duplicados.
- Antes de publicar un producto se vuelve a consultar Shopify. Si ya no es elegible o su estado no puede verificarse, se detienen todas las redes.
- La limpieza automática espera los días configurados después de la publicación confirmada. Elimina recursos y textos de la pieza, pero conserva lote, calendario, intentos e historial. No limpia si otra entrada de la misma pieza sigue pendiente o con errores.
- En Kimi el worker no queda ejecutándose al abrir el panel. Para operación programada, ejecuta `npm run publishing:worker` cada minuto desde el scheduler disponible. El archivo cron de Docker ya incluye esa frecuencia.

```bash
npm run publishing:worker
docker compose run --rm publisher
```

## Verificación antes de entregar cambios

```bash
npm run check
npm test
npm run build
npm run worker:build
```

La autorización y la publicación son procesos distintos. La cola persistente conserva estados independientes por red y no repite automáticamente respuestas ambiguas o fallidas. Las credenciales y las aprobaciones exigidas por cada plataforma se configuran fuera del chat.
