/* =============================================================================
   sw-imagenes.js — caché de fotos de artículos con vencimiento a 7 días
   =============================================================================

   QUÉ HACE
   Guarda en el disco de la PC las fotos de los artículos la primera vez que se
   ven. A partir de ahí la caja las muestra desde ahí: instantáneas, sin gastar
   internet y aunque la conexión ande mal o se corte.

   POR QUÉ HACE FALTA
   Sin esto, si el servidor donde están alojadas las fotos pide "no las guardes",
   la caja las vuelve a bajar todos los días. Con esto la decisión es nuestra.

   CUÁNDO SE RENUEVAN
   · Automático: cada foto se vuelve a bajar entera a los 7 días de guardada.
     La renovación es escalonada (cada foto cumple sus 7 días por su cuenta),
     así nunca hay un día en que se re-descargue todo de golpe.
   · Manual: subir CACHE_VERSION_IMG en ingresoPedidoV2.js cambia la dirección
     de todas las fotos y las renueva a todas de una.

   ALCANCE
   Sólo se mete con imágenes de OTROS dominios (las fotos de la planilla).
   Todo lo del propio sitio — HTML, JS, CSS, logo — pasa de largo y se maneja
   como siempre, para no interferir con los despliegues ni con las otras
   páginas del repo.
   ========================================================================== */

const VERSION      = 'v1';
const CACHE_IMG    = `hp-img-${VERSION}`;        // las fotos
const CACHE_META   = `hp-img-meta-${VERSION}`;   // la fecha en que se guardó cada una

const MAX_EDAD_MS  = 7 * 24 * 60 * 60 * 1000;    // 7 días
const REINTENTO_MS = 60 * 60 * 1000;             // si la renovación falla, se reintenta en 1 h
const MAX_ENTRADAS = 500;                        // techo del caché; se poda por antigüedad

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    // Al subir VERSION se descartan los cachés de la versión anterior.
    const nombres = await caches.keys();
    await Promise.all(
      nombres
        .filter(n => n.startsWith('hp-img-') && n !== CACHE_IMG && n !== CACHE_META)
        .map(n => caches.delete(n))
    );
    await self.clients.claim();
  })());
});

/* ------------------------------------------------------- fecha de guardado --
   Las respuestas de otro dominio llegan "opacas": el navegador no deja leer ni
   sus cabeceras ni su contenido, así que no se les puede pegar la fecha encima.
   Por eso la fecha vive en un caché aparte, con una clave inventada por foto.
   Esa clave nunca se pide por red: es sólo una etiqueta. */

function claveFecha(url) {
  return new Request('https://hp-img-meta.invalid/?u=' + encodeURIComponent(url));
}

async function leerFecha(url) {
  try {
    const meta = await caches.open(CACHE_META);
    const res = await meta.match(claveFecha(url));
    if (!res) return 0;
    const dato = await res.json();
    return dato && dato.t ? dato.t : 0;
  } catch (e) {
    return 0;
  }
}

async function escribirFecha(url, t) {
  try {
    const meta = await caches.open(CACHE_META);
    await meta.put(claveFecha(url), new Response(JSON.stringify({ t: t || Date.now() })));
  } catch (e) { /* sin fecha la foto se trata como vencida: se renueva, nada se rompe */ }
}

async function borrarFecha(url) {
  try {
    const meta = await caches.open(CACHE_META);
    await meta.delete(claveFecha(url));
  } catch (e) {}
}

/* ------------------------------------------------------------------ poda --
   Cada foto guardada ocupa lugar y el navegador le asigna a la app una cuota.
   Si se llega al techo se borran las más viejas primero. La poda no corre en
   cada guardado: sale cara y no hace falta tan seguido. */

let guardadosDesdeLaPoda = 0;

async function podar(forzar) {
  guardadosDesdeLaPoda++;
  if (!forzar && guardadosDesdeLaPoda < 25) return;
  guardadosDesdeLaPoda = 0;

  try {
    const cache = await caches.open(CACHE_IMG);
    const claves = await cache.keys();
    if (claves.length <= MAX_ENTRADAS) return;

    const conFecha = await Promise.all(
      claves.map(async req => ({ req, t: await leerFecha(req.url) }))
    );
    conFecha.sort((a, b) => a.t - b.t);               // las más viejas primero

    const sobran = conFecha.slice(0, claves.length - MAX_ENTRADAS);
    await Promise.all(sobran.map(async ({ req }) => {
      await cache.delete(req);
      await borrarFecha(req.url);
    }));
  } catch (e) {}
}

async function vaciar() {
  await caches.delete(CACHE_IMG);
  await caches.delete(CACHE_META);
  guardadosDesdeLaPoda = 0;
}

/* --------------------------------------------------------------- guardado -- */

async function guardar(req, res) {
  if (!res) return;
  // Una respuesta opaca no deja ver si fue un 200 o un 404. Se guarda igual —
  // es lo único que el navegador entrega para una <img> de otro dominio — y del
  // caso "la foto no existe" ya se encarga el onerror de la página, que cae al
  // cuarto link. Las respuestas que sí se pueden leer y vinieron con error no
  // se guardan: cachear un error por 7 días sería peor que no cachear nada.
  if (res.type !== 'opaque' && !res.ok) return;

  try {
    const cache = await caches.open(CACHE_IMG);
    await cache.put(req, res);
    await escribirFecha(req.url);
    await podar(false);
  } catch (e) {
    // Sin espacio disponible: se limpia todo y se sigue trabajando sin caché.
    if (e && (e.name === 'QuotaExceededError' || e.code === 22)) await vaciar();
  }
}

/* ------------------------------------------------------------ estrategias -- */

// Renovación en segundo plano de una foto que ya cumplió los 7 días.
// La pantalla no espera por esto: ya se le entregó la copia guardada.
async function renovar(req) {
  try {
    const res = await fetch(req, { cache: 'reload' });
    await guardar(req, res.clone());
  } catch (e) {
    // El host no respondió. Se conserva la foto vieja y se reintenta en una
    // hora, en vez de castigar cada dibujado de la tabla con un pedido fallido.
    await escribirFecha(req.url, Date.now() - MAX_EDAD_MS + REINTENTO_MS);
  }
}

async function traerYGuardar(req) {
  try {
    const res = await fetch(req);
    await guardar(req, res.clone());
    return res;
  } catch (e) {
    // Sin internet y sin copia previa: se deja que la <img> falle, y su onerror
    // muestra el link alternativo o esconde la foto.
    const cache = await caches.open(CACHE_IMG);
    const vieja = await cache.match(req);
    if (vieja) return vieja;
    throw e;
  }
}

async function resolverImagen(evento, req) {
  const cache = await caches.open(CACHE_IMG);
  const guardada = await cache.match(req);
  if (!guardada) return traerYGuardar(req);

  const t = await leerFecha(req.url);
  const vencida = !t || (Date.now() - t) > MAX_EDAD_MS;
  if (vencida) evento.waitUntil(renovar(req));   // se muestra la vieja, se baja la nueva

  return guardada;
}

/* ---------------------------------------------------------------- ruteo --- */

function esImagen(req, url) {
  if (req.destination === 'image') return true;                    // navegadores actuales
  if (req.destination) return false;                               // lo dijo y no es imagen
  if (/\.(jpe?g|png|webp|gif|avif|bmp|svg)($|\?)/i.test(url.pathname + url.search)) return true;
  return (req.headers.get('accept') || '').includes('image/');     // último recurso
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (err) { return; }

  // Sólo fotos alojadas fuera de este sitio. El HTML, el JS, el CSS y el logo
  // se sirven como siempre: el Service Worker ni se entera.
  if (url.origin === self.location.origin) return;
  if (!esImagen(req, url)) return;

  e.respondWith(resolverImagen(e, req));
});

/* --------------------------------------------------- comandos de la página -- */

self.addEventListener('message', e => {
  const dato = e.data || {};
  if (dato.tipo === 'purgar-imagenes') {
    e.waitUntil(vaciar());
  }
});
