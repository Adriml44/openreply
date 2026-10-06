# OpenReply multirred: Facebook, Threads y YouTube

Una campaña puede estar ahora en varias redes a la vez. Arriba del formulario
eliges las redes (Instagram, Facebook, Threads, YouTube) y cada pestaña tiene
**su propia publicación, sus respuestas en comentario y sus DMs**. Las palabras
clave y el nombre son comunes.

| Red | Qué hace | Cómo se entera de los comentarios |
|---|---|---|
| Instagram | Todo, como siempre | Webhook + repaso cada 5 min |
| Facebook (páginas) | Todo: DM privado, respuesta pública, enlaces con botón, seguir obligatorio, mensaje de seguimiento | Webhook + repaso cada 5 min |
| Threads | Solo respuesta pública (Threads no tiene DMs en su API) | Repaso cada 5 min |
| YouTube | Solo respuesta pública (YouTube no tiene DMs) | Repaso cada 5 min |

## Protección contra baneos (lo que hace solo)

- **Una respuesta por persona y campaña cada 24 h.** Quien comenta «LINK» cinco
  veces recibe una, no cinco.
- **Threads y YouTube:** al menos **3 respuestas distintas** que rotan; salen
  repartidas en varios minutos, como si contestara una persona; tope de
  30/hora y 200/día en Threads y de 12/hora y 80/día en YouTube (muy por debajo
  de sus límites reales). Lo que pase del tope espera, no se pierde.
- **Instagram y Facebook:** el tope de Meta (750 DMs/hora) con margen, una sola
  respuesta privada por comentario (lo exige Meta), nunca a tus propios
  comentarios ni a respuestas de comentarios.
- Todo por las **APIs oficiales**: sin contraseñas, sin automatizar el navegador.

**Seguir obligatorio:** en Instagram se comprueba de verdad si te sigue. En
Facebook la API no permite saber quién sigue una página: se le pide que la siga
y el enlace llega al pulsar el botón.

## Puesta en marcha

### 1. Variables nuevas (Vercel **y** Railway)

```
FACEBOOK_APP_ID=        # la misma app de Meta que usas para Instagram
THREADS_APP_ID=         # Meta for Developers → tu app → caso de uso «Threads API»
THREADS_APP_SECRET=
GOOGLE_CLIENT_ID=       # Google Cloud → APIs y servicios → Credenciales (OAuth, tipo Web)
GOOGLE_CLIENT_SECRET=
CRM_HOOK_URL=https://crm.relevx.com/hook/openreply   # opcional: cada persona que recibe el enlace entra al CRM como lead
CRM_HOOK_KEY=           # la «clave_webhook» del config.php del CRM
```

### 2. Direcciones de vuelta (redirect URIs)

En cada app, añade como URL de redirección válida:

- Facebook (Facebook Login): `https://TU-DOMINIO/api/facebook/callback`
- Threads: `https://TU-DOMINIO/api/threads/callback`
- Google (YouTube): `https://TU-DOMINIO/api/youtube/callback` y activa **YouTube Data API v3**

### 3. Webhook de Facebook

Meta for Developers → tu app → Webhooks → objeto **Page** → la misma URL que el
de Instagram (`https://TU-DOMINIO/api/webhook`, mismo token de verificación).
Suscribe los campos `feed`, `messages`, `messaging_postbacks` y `message_reads`.
Al conectar una página, OpenReply la suscribe sola.

### 4. Permisos que Meta tiene que aprobar (revisión de la app)

- Facebook: `pages_show_list`, `pages_read_engagement`, `pages_manage_metadata`,
  `pages_manage_engagement`, `pages_read_user_content`, `pages_messaging`.
- Threads: `threads_basic`, `threads_read_replies`, `threads_manage_replies`,
  `threads_content_publish`.
- Google: la pantalla de consentimiento con el permiso `youtube.force-ssl`
  (mientras esté «en pruebas», añade tu correo como usuario de prueba).

Hasta que estén aprobados, solo funcionan con las cuentas que tengas como
administrador o probador de la app.

### 5. Desplegar

Base de datos: la migración `20261006120000_multi_network` se aplica sola en el
build de Vercel (`prisma migrate deploy`). Reinicia también el worker de Railway
para que coja el código nuevo.

### 6. Conectar

Ajustes → **Connect Facebook Page / Connect Threads / Connect YouTube**.
