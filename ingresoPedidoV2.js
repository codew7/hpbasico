// Script para ingresoPedidoV2.html: manejo de formulario, artículos dinámicos y registro en Firebase

// === CACHÉ LOCAL DE LAS FOTOS DE ARTÍCULOS (sw-imagenes.js) ===
// Las fotos viven en un host externo y su política de caché la decide ese host:
// si dice "no guardar", la caja las vuelve a bajar todos los días. El Service
// Worker se queda con una copia en el disco de la PC y la sirve por 7 días,
// así la tabla se pinta al instante y sigue mostrando las fotos aunque la
// conexión se corte. Pasados los 7 días cada foto se re-descarga entera, sin
// necesidad de tocar CACHE_VERSION_IMG.
//
// El registro es opcional a propósito: si el navegador no soporta Service
// Workers, o la página se abre por file:// o sin HTTPS, no pasa nada — las
// imágenes se cargan como siempre.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    // Ruta relativa a propósito: el scope queda en la carpeta del script, así
    // funciona igual si algún día el sitio se sirve bajo un subdirectorio.
    navigator.serviceWorker.register('sw-imagenes.js')
      .catch(function (err) {
        console.warn('Caché de imágenes no disponible:', err && err.message);
      });
  });
}

// Purga manual desde la consola: homepointPurgarImagenes()
// Útil si se cambió una foto y hay que verla ya, sin esperar los 7 días.
window.homepointPurgarImagenes = function () {
  if (navigator.serviceWorker && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({ tipo: 'purgar-imagenes' });
    console.log('Caché de imágenes purgado. Recargá la página.');
  } else {
    console.warn('No hay Service Worker activo todavía.');
  }
};

// Válvula de escape: homepointDesactivarCache() apaga el caché de imágenes por
// completo en esa PC. Es el botón de pánico si alguna vez el Service Worker da
// problemas en el mostrador; se vuelve a activar solo al recargar la página.
window.homepointDesactivarCache = function () {
  if (!navigator.serviceWorker) return;
  navigator.serviceWorker.getRegistrations().then(function (regs) {
    regs.filter(function (r) { return /sw-imagenes\.js$/.test(r.active && r.active.scriptURL || ''); })
        .forEach(function (r) { r.unregister(); });
    console.log('Caché de imágenes desactivado. Recargá la página.');
  });
};

// === TIPOS DE LÍNEA: VENTA / DEVOLUCION / GARANTIA ===
// Una orden puede mezclar venta con la devolución de un artículo de un pedido anterior.
// El signo económico y el tipo de movimiento de inventario se derivan del tipo de línea:
//
//   VENTA       -> movimiento SALIDA,  suma al subtotal y a los costos   (signo +1)
//   DEVOLUCION  -> movimiento ENTRADA, resta del subtotal y de los costos (signo -1)
//   GARANTIA    -> movimiento SALIDA,  no aporta importe ni costo         (signo  0)
//
// GARANTIA es la reposición sin cargo de un artículo fallado: la unidad fallada NO vuelve
// al depósito (la SALIDA original ya la descontó), pero la unidad de reemplazo sí sale.
// valorU y valorC se guardan SIEMPRE en positivo; el signo vive únicamente en tipoLinea.
// Los pedidos históricos no tienen tipoLinea: la ausencia se interpreta como VENTA.
function signoLinea(it) {
  if (!it || !it.tipoLinea || it.tipoLinea === 'VENTA') return 1;
  return it.tipoLinea === 'DEVOLUCION' ? -1 : 0;
}
function esLineaCambio(it) {
  return !!it && !!it.tipoLinea && it.tipoLinea !== 'VENTA';
}
function totalLinea(it) {
  return signoLinea(it) * (parseInt(it && it.cantidad, 10) || 0) * (parseInt(it && it.valorU, 10) || 0);
}
function costoLinea(it) {
  return signoLinea(it) * (parseInt(it && it.cantidad, 10) || 0) * (parseInt(it && it.valorC, 10) || 0);
}

// Lee un importe de un campo del formulario conservando el signo.
// El helper anterior (replace(/\D/g,'')) borraba el "-", así que una devolución con saldo
// a favor del cliente se habría guardado en Firebase como un importe POSITIVO.
function parseImporte(str) {
  const txt = (str === null || str === undefined) ? '' : String(str);
  // El signo puede venir después del símbolo de moneda ("$ -5.000"): se busca cualquier
  // "-" que aparezca antes del primer dígito.
  const primerDigito = txt.search(/\d/);
  const negativo = txt.slice(0, primerDigito === -1 ? txt.length : primerDigito).includes('-');
  const n = parseInt(txt.replace(/\D/g, ''), 10) || 0;
  return negativo ? -n : n;
}

// === PRECIO REALMENTE PAGADO EN EL PEDIDO ORIGINAL ===
// Un pedido guarda el descuento como MONTO global (nunca como %), así que para saber
// cuánto pagó el cliente por cada unidad hay que prorratearlo sobre sus líneas de venta.
// Devuelve 1 cuando el pedido no tuvo descuento: la devolución sale al valor de lista.
function factorDescuentoOrigen(pedido) {
  if (!pedido) return 1;
  const descuento = parseImporte(pedido.pagos && pedido.pagos.descuento);
  if (descuento <= 0) return 1;
  // La base es la suma de las líneas de VENTA, no pagos.subtotal: calcularTotalFinal
  // aplica el % sobre esa base, y en un pedido que a su vez fue un cambio el subtotal
  // guardado ya viene neteado por las devoluciones.
  const base = (pedido.items || []).reduce(
    (acc, it) => acc + (signoLinea(it) > 0 ? totalLinea(it) : 0), 0);
  // Un descuento que se coma toda la base sería un dato corrupto: no se ajusta nada.
  if (base <= 0 || descuento >= base) return 1;
  return (base - descuento) / base;
}

document.addEventListener('DOMContentLoaded', function() {
  // === BLOQUEO DE CONTROLES HASTA CARGA DE ARTÍCULOS ===
  // Elementos a bloquear: inputs, selects, botones, tabla de artículos
  let bloqueables = [];
  // Firebase ya está inicializado en el HTML

  // Elementos del DOM
  const form = document.getElementById('orderForm');
  const itemsBody = document.getElementById('itemsBody');
  const searchInput = document.getElementById('searchInput');
  const searchQuantity = document.getElementById('searchQuantity');
  const searchResults = document.getElementById('searchResults');
  const addSearchItemBtn = document.getElementById('addSearchItemBtn');
  // Inicializar bloqueables aquí, después de declarar form, itemsBody
  bloqueables = [];
  if (form) {
    Array.from(form.elements).forEach(el => {
      if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'BUTTON' || el.type === 'button' || el.type === 'submit') {
        bloqueables.push(el);
      }
    });
  }
  if (itemsBody) bloqueables.push(itemsBody);
  function setControlesBloqueados(bloquear) {
    bloqueables.forEach(el => {
      if (!el) return;
      if (el === itemsBody) {
        Array.from(itemsBody.querySelectorAll('input, select, button')).forEach(ctrl => {
          ctrl.disabled = bloquear;
          if (bloquear) ctrl.classList.add('cargando-articulos');
          else ctrl.classList.remove('cargando-articulos');
        });
      } else {
        el.disabled = bloquear;
        if (bloquear) el.classList.add('cargando-articulos');
        else el.classList.remove('cargando-articulos');
      }
    });
    if (bloquear) {
      document.body.classList.add('cargando-articulos-body');
    } else {
      document.body.classList.remove('cargando-articulos-body');
    }
  }
  // Bloquear al inicio
  setControlesBloqueados(true);
  const subtotalInput = document.getElementById('subtotal');
  const totalFinalInput = document.getElementById('totalFinal');
  const recargoInput = document.getElementById('recargo');
  const descuentoInput = document.getElementById('descuento');
  const descuentoPorcentajeInput = document.getElementById('descuentoPorcentaje');
  const recargoPorcentajeInput = document.getElementById('recargoPorcentaje');
  const envioInput = document.getElementById('envio');
  const messageDiv = document.getElementById('message');

  let items = [];
  
  // Variable para bloquear la interfaz durante procesos críticos de Firebase
  let procesoCriticoEnEjecucion = false;
  let enviandoPedido = false; // Guard contra doble clic en submit
  
  // Prevenir cierre de ventana durante procesos críticos
  window.addEventListener('beforeunload', function(e) {
    if (procesoCriticoEnEjecucion) {
      e.preventDefault();
      e.returnValue = 'Hay un proceso de registro en curso. Si cierra la ventana, los datos pueden no guardarse correctamente.';
      return e.returnValue;
    }
  });
  
  // Función para bloquear toda la interfaz durante procesos críticos
  function bloquearInterfaz(mensaje = 'Guardando datos...') {
    procesoCriticoEnEjecucion = true;
    
    // Crear overlay de bloqueo si no existe
    let overlay = document.getElementById('overlayBloqueo');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'overlayBloqueo';
      overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.7);
        z-index: 999999;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-direction: column;
      `;
      
      const contenido = document.createElement('div');
      contenido.style.cssText = `
        background: white;
        padding: 30px 50px;
        border-radius: 10px;
        text-align: center;
        box-shadow: 0 4px 20px rgba(0,0,0,0.3);
      `;
      
      const spinner = document.createElement('div');
      spinner.style.cssText = `
        border: 4px solid #f3f3f3;
        border-top: 4px solid #3498db;
        border-radius: 50%;
        width: 40px;
        height: 40px;
        animation: spin 1s linear infinite;
        margin: 0 auto 20px auto;
      `;
      
      const texto = document.createElement('p');
      texto.id = 'textoBloqueo';
      texto.style.cssText = `
        margin: 0;
        font-size: 16px;
        font-weight: bold;
        color: #333;
      `;
      texto.textContent = mensaje;
      
      const advertencia = document.createElement('p');
      advertencia.style.cssText = `
        margin: 10px 0 0 0;
        font-size: 12px;
        color: #e74c3c;
      `;
      advertencia.textContent = '⚠️ No cierre ni recargue esta ventana';
      
      contenido.appendChild(spinner);
      contenido.appendChild(texto);
      contenido.appendChild(advertencia);
      overlay.appendChild(contenido);
      
      // Agregar animación de spinner
      const style = document.createElement('style');
      style.textContent = `
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `;
      document.head.appendChild(style);
      
      document.body.appendChild(overlay);
    } else {
      overlay.style.display = 'flex';
      const textoBloqueo = document.getElementById('textoBloqueo');
      if (textoBloqueo) textoBloqueo.textContent = mensaje;
    }
    
    // Deshabilitar todos los controles del formulario
    if (form) {
      Array.from(form.elements).forEach(el => {
        el.disabled = true;
      });
    }
  }
  
  // Función para desbloquear la interfaz
  function desbloquearInterfaz() {
    procesoCriticoEnEjecucion = false;
    
    const overlay = document.getElementById('overlayBloqueo');
    if (overlay) {
      overlay.style.display = 'none';
    }
    
    // Rehabilitar controles del formulario (excepto tipoCliente, siempre de solo lectura)
    if (form) {
      Array.from(form.elements).forEach(el => {
        el.disabled = false;
      });
    }
    radiosTipoCliente.forEach(radio => { radio.disabled = true; });
  }

  // === COTIZACIÓN DÓLAR ===
  const cotizacionValorElement = document.getElementById('cotizacionValor');
  let cotizacionActual = null;

  function cargarCotizacionDolar() {
    if (!cotizacionValorElement) return;
    
    cotizacionValorElement.textContent = 'Cargando...';
    
    fetch('https://api.bluelytics.com.ar/v2/latest')
      .then(response => response.json())
      .then(data => {
        cotizacionActual = data.blue.value_avg || data.blue.avg;
        if (cotizacionActual) {
          cotizacionValorElement.textContent = `$${cotizacionActual.toLocaleString('es-AR')}`;
          cotizacionValorElement.style.color = '#28a745';
        } else {
          cotizacionValorElement.textContent = 'No disponible';
          cotizacionValorElement.style.color = '#dc3545';
        }
      })
      .catch(error => {
        console.error('Error al cargar cotización:', error);
        cotizacionValorElement.textContent = 'Error al cargar';
        cotizacionValorElement.style.color = '#dc3545';
      });
  }

  // Cargar cotización al inicializar y actualizar cada 30 minutos
  cargarCotizacionDolar();
  setInterval(cargarCotizacionDolar, 30 * 60 * 1000);

  // === DIF%USD DESDE GOOGLE SHEETS (Dolar!C2) ===
  const difUSDValorElement = document.getElementById('difUSDValor');
  function cargarDifUSD() {
    if (!difUSDValorElement) return;
    fetch(`https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEETS_CONFIG.SPREADSHEET_ID}/values/Dolar!C2?key=${GOOGLE_SHEETS_CONFIG.API_KEY}`)
      .then(response => response.json())
      .then(data => {
        const valor = data.values && data.values[0] && data.values[0][0];
        if (valor !== undefined && valor !== '') {
          difUSDValorElement.textContent = valor;
          const numerico = parseFloat(String(valor).replace(',', '.'));
          if (!isNaN(numerico) && numerico < 0) {
            difUSDValorElement.style.color = '#dc3545';
            mostrarAlertaDifUSD(true);
          } else {
            difUSDValorElement.style.color = '#28a745';
            mostrarAlertaDifUSD(false);
          }
        } else {
          difUSDValorElement.textContent = 'No disponible';
          difUSDValorElement.style.color = '#dc3545';
        }
      })
      .catch(() => {
        difUSDValorElement.textContent = 'Error al cargar';
        difUSDValorElement.style.color = '#dc3545';
      });
  }

  function mostrarAlertaDifUSD(mostrar) {
    let banner = document.getElementById('alertaDifUSD');
    if (mostrar) {
      if (!banner) {
        banner = document.createElement('div');
        banner.id = 'alertaDifUSD';
        banner.textContent = 'ATENCIÓN: Cotización USD desfavorable. Revisar precios';
        banner.style.cssText = 'background:#dc3545;color:#000;font-weight:700;text-align:center;padding:10px 16px;font-size:1rem;letter-spacing:0.02em;position:sticky;top:0;z-index:9999;';
        document.body.insertBefore(banner, document.body.firstChild);
      }
    } else {
      if (banner) banner.remove();
    }
  }

  cargarDifUSD();
  setInterval(cargarDifUSD, 30 * 60 * 1000);

  // === CARGA DE ARTÍCULOS DESDE GOOGLE SHEETS ===
  let articulosDisponibles = [];
  // Índices para el lector de código de barras. Un mismo código puede pertenecer a
  // varios artículos, por eso cada clave acumula un array de coincidencias.
  let articulosPorCodigo = {};        // código de barras normalizado -> [artículo, ...]
  let articulosPorCodigoInterno = {}; // código interno (col C) normalizado -> [artículo, ...]
  let articulosPorNombre = {};

  // Normalización única para comparar códigos escaneados contra los índices.
  function normalizarCodigoBarras(v) {
    return String(v || '').trim().toUpperCase();
  }

  function indexarCodigo(mapa, codigo, item) {
    const k = normalizarCodigoBarras(codigo);
    if (!k) return;
    if (!mapa[k]) mapa[k] = [];
    if (!mapa[k].includes(item)) mapa[k].push(item);
  }

  // Devuelve los artículos que coinciden EXACTAMENTE con un código escaneado.
  // Prioriza el código de barras (col L) y recién después el código interno (col C).
  function resolverCodigoEscaneado(texto) {
    const k = normalizarCodigoBarras(texto);
    if (!k) return [];
    let candidatos = articulosPorCodigo[k] || [];
    if (candidatos.length === 0) candidatos = articulosPorCodigoInterno[k] || [];
    return candidatos.filter(art => art[4]?.toLowerCase() !== 'no disponible');
  }

  // Radios de tipo de cliente
  let radiosTipoCliente = [];
  // Insertar radios de tipo de cliente debajo de Datos del Cliente
  const clienteSection = document.querySelector('section[aria-labelledby="datos-cliente-title"]');
  const extraClienteFields = document.getElementById('extraClienteFields');

  // Teléfono, DNI y Email quedan permanentemente ocultos (sin toggle): ya no
  // se piden en el pedido. El radio Tipo de Cliente sigue inyectándose dentro
  // de extraClienteFields, también oculto, porque define el precio por artículo.
  if (clienteSection && !document.getElementById('tipoClienteRow')) {
    const tipoClienteRow = document.createElement('div');
    tipoClienteRow.className = 'form-row';
    tipoClienteRow.id = 'tipoClienteRow';
    tipoClienteRow.innerHTML = `
      <label style="font-weight:bold;">Tipo de Cliente:</label>
      <label style="margin-left:10px;"><input type="radio" name="tipoCliente" value="consumidor final"> Consumidor</label>
      <label style="margin-left:10px;"><input type="radio" name="tipoCliente" value="mayorista" checked> Mayorista</label>
      <label style="margin-left:10px;"><input type="radio" name="tipoCliente" value="admin"> Administrador</label>
    `;
    (extraClienteFields || clienteSection).appendChild(tipoClienteRow);
    radiosTipoCliente = Array.from(tipoClienteRow.querySelectorAll('input[type="radio"][name="tipoCliente"]'));
  } else if (clienteSection) {
    radiosTipoCliente = Array.from(document.querySelectorAll('input[type="radio"][name="tipoCliente"]'));
  }

  // === FUNCIÓN PARA ACTUALIZAR TODOS LOS ITEMS DESPUÉS DE CARGAR GOOGLE SHEETS ===
  function actualizarTodosLosItems() {
    items.forEach(item => {
      if (item.nombre && articulosPorNombre[item.nombre]) {
        // Preservar cantidad actual
        const cantidadActual = item.cantidad;
        // Usar función auxiliar para actualizar campos
        actualizarCamposArticulo(item, item.nombre);
        // Restaurar cantidad
        item.cantidad = cantidadActual;
        // Recalcular valorG
        item.valorG = signoLinea(item) * (item.valorU - item.valorC) * (item.cantidad || 1);
      }
    });
    // Re-renderizar para mostrar cambios
    renderItems();
  }

  // Cargar artículos al iniciar
  fetch(`https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEETS_CONFIG.SPREADSHEET_ID}/values/${GOOGLE_SHEETS_CONFIG.RANGO}?key=${GOOGLE_SHEETS_CONFIG.API_KEY}`)
    .then(response => response.json())
    .then(data => {
      const items = data.values || [];
      articulosDisponibles = items.filter(item => item[4]?.toLowerCase() !== 'no disponible');
      articulosPorCodigo = {};
      articulosPorCodigoInterno = {};
      articulosDisponibles.forEach(item => {
        // Usar Columna L (índice 11) para códigos de barras (puede contener múltiples códigos separados por comas)
        if (item[11]) {
          item[11].split(',').forEach(codigo => indexarCodigo(articulosPorCodigo, codigo, item));
        }
        // Columna C (índice 2): código interno, también usable con etiquetas propias
        indexarCodigo(articulosPorCodigoInterno, item[2], item);
        articulosPorNombre[item[3]] = item;
      });
      
      // Actualizar items existentes con datos frescos de Google Sheets
      actualizarTodosLosItems();
      // Habilitar controles después de cargar
      setControlesBloqueados(false);
      // Mantener tipoCliente como solo lectura
      radiosTipoCliente.forEach(radio => radio.disabled = true);
      
      // Inicializar buscador de artículos después de cargar
      initializeSearchArticulos();
    })
    .catch(() => {
      // Si falla la carga, mantener controles deshabilitados
      setControlesBloqueados(true);
      radiosTipoCliente.forEach(radio => radio.disabled = true);
      // Sin catálogo el escáner no puede resolver nada: avisarlo en el panel en
      // lugar de dejar un buscador mudo (initializeSearchArticulos no llegó a correr).
      setEstadoScanner('catalogo-error', 'No se pudo cargar el catálogo');
    });
  // === ESTILOS PARA BLOQUEO VISUAL ===
  const styleCargando = document.createElement('style');
  styleCargando.innerHTML = `
    .cargando-articulos { opacity: 0.6 !important; cursor: not-allowed !important; }
    .cargando-articulos-body { cursor: progress !important; }
    .optimizing-table { opacity: 0.8; pointer-events: none; }
    .optimizing-table::after { 
      content: 'Optimizando tabla...'; 
      position: absolute; 
      top: 50%; 
      left: 50%; 
      transform: translate(-50%, -50%); 
      background: rgba(255,255,255,0.9); 
      padding: 10px 20px; 
      border-radius: 4px; 
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      font-weight: bold;
      z-index: 1000;
    }
  `;
  document.head.appendChild(styleCargando);

  // Helper: always read current cliente type from DOM
function getTipoCliente() {
  const sel = document.querySelector('input[name="tipoCliente"]:checked');
  return sel ? sel.value : 'consumidor final';
}

  // === FUNCIÓN PARA OBTENER LA PRIMERA IMAGEN DE UN ARTÍCULO ===
  function obtenerPrimeraImagen(nombreArticulo) {
    if (!nombreArticulo || !articulosPorNombre[nombreArticulo]) {
      return '';
    }
    const art = articulosPorNombre[nombreArticulo];
    const imagenesStr = art[1] || ''; // Columna B (índice 1)
    if (!imagenesStr) return '';
    
    // Dividir por comas y tomar la primera imagen
    const imagenes = imagenesStr.split(',');
    return imagenes[0]?.trim() || '';
  }

  // === IMÁGENES: misma lógica que mayorista.js (1er link → 4to link → fallback) ===
  // Subir esta versión invalida TODAS las imágenes cacheadas (cambia la URL, así
  // que cambia también la clave del caché del navegador y la del Service Worker).
  // Es la palanca manual; la automática son los 7 días de sw-imagenes.js.
  const CACHE_VERSION_IMG = "2.2";
  function getCacheBustedURL(url) {
    if (!url || url === 'no-disponible.png') return url;
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}v=${CACHE_VERSION_IMG}`;
  }

  // A partir del string de la columna B (links separados por comas) devuelve
  // { principal, alt } = 1er y 4to link (con cache busting). No se filtran vacíos
  // para preservar la posición del 4to link, igual que mayorista.js (imageUrls[3]).
  function imagenesDeStr(imagenesStr) {
    const imgs = (imagenesStr || '').split(',').map(s => s.trim());
    return {
      principal: imgs[0] ? getCacheBustedURL(imgs[0]) : '',
      alt: imgs[3] ? getCacheBustedURL(imgs[3]) : ''
    };
  }

  // Igual que obtenerPrimeraImagen pero devuelve { principal, alt } por nombre.
  function obtenerImagenesArticulo(nombreArticulo) {
    if (!nombreArticulo || !articulosPorNombre[nombreArticulo]) return { principal: '', alt: '' };
    return imagenesDeStr(articulosPorNombre[nombreArticulo][1] || '');
  }

  // onerror autocontenido para usar en HTML inline: cae al 4to link (data-alt)
  // y, si tampoco carga, aplica el fallback pasado (por defecto ocultar la img).
  // `loading="lazy"` evita pedir las fotos de las filas que quedaron abajo del
  // scroll y que muchas ventas nunca llegan a mostrar.
  function imgFallbackAttrs(alt, fallbackJs = "this.style.display='none';") {
    return `referrerpolicy="no-referrer" loading="lazy" decoding="async" data-alt="${alt || ''}" onerror="if(this.dataset.alt && this.dataset.fell!=='1'){this.dataset.fell='1';this.src=this.dataset.alt;}else{${fallbackJs}}"`;
  }

  // === FUNCIÓN PARA CREAR EFECTO HOVER DE IMAGEN (OPTIMIZADA) ===
  let allHoverDivs = new Map(); // Para gestionar todos los hover divs
  
  function crearHoverImagen(imgElement, imagenUrl, imagenAlt) {
    if (!imagenUrl) return;
    
    let hoverDiv = null;
    const hoverKey = Math.random().toString(36).substring(7); // ID único
    
    function showHover() {
      // Crear div flotante si no existe
      if (!hoverDiv) {
        hoverDiv = document.createElement('div');
        hoverDiv.style.position = 'fixed';
        hoverDiv.style.zIndex = '10000';
        hoverDiv.style.backgroundColor = 'white';
        hoverDiv.style.border = '2px solid #ccc';
        hoverDiv.style.borderRadius = '8px';
        hoverDiv.style.padding = '5px';
        hoverDiv.style.boxShadow = '0 4px 16px rgba(0,0,0,0.3)';
        hoverDiv.style.pointerEvents = 'none';
        hoverDiv.style.display = 'none';
        
        const hoverImg = document.createElement('img');
        hoverImg.referrerPolicy = 'no-referrer';
        hoverImg.decoding = 'async';
        hoverImg.src = imagenUrl;
        hoverImg.style.width = '300px';
        hoverImg.style.height = '300px';
        hoverImg.style.objectFit = 'cover';
        hoverImg.style.display = 'block';
        hoverImg.style.borderRadius = '4px';

        // Manejar error de carga: 1er link → 4to link → mensaje "no disponible"
        let hoverFallbackStep = 0;
        hoverImg.onerror = function() {
          if (hoverFallbackStep === 0 && imagenAlt) {
            hoverFallbackStep = 1;
            this.src = imagenAlt;
          } else {
            hoverFallbackStep = 2;
            hoverDiv.innerHTML = '<div style="width:150px;height:150px;display:flex;align-items:center;justify-content:center;color:#666;font-size:14px;">Imagen no disponible</div>';
          }
        };
        
        hoverDiv.appendChild(hoverImg);
        document.body.appendChild(hoverDiv);
        
        // Registrar en el mapa para limpieza posterior
        allHoverDivs.set(hoverKey, hoverDiv);
      }
      
      // Posicionar cerca del mouse, ajustando para no salirse de la pantalla
      const rect = imgElement.getBoundingClientRect();
      let left = rect.right + 10;
      let top = rect.top - 75;
      
      // Ajustar si se sale de la pantalla por la derecha
      if (left + 160 > window.innerWidth) {
        left = rect.left - 160;
      }
      
      // Ajustar si se sale de la pantalla por arriba
      if (top < 0) {
        top = 10;
      }
      
      // Ajustar si se sale de la pantalla por abajo
      if (top + 160 > window.innerHeight) {
        top = window.innerHeight - 170;
      }
      
      hoverDiv.style.left = left + 'px';
      hoverDiv.style.top = top + 'px';
      hoverDiv.style.display = 'block';
    }
    
    function hideHover() {
      if (hoverDiv) {
        hoverDiv.style.display = 'none';
      }
    }
    
    // Event listeners con throttling
    let mouseEnterTimeout;
    imgElement.addEventListener('mouseenter', function(e) {
      clearTimeout(mouseEnterTimeout);
      mouseEnterTimeout = setTimeout(showHover, 100); // Pequeño delay para evitar hover accidental
    });
    
    imgElement.addEventListener('mouseleave', function() {
      clearTimeout(mouseEnterTimeout);
      hideHover();
    });
    
    // Retornar función de limpieza para llamar manualmente
    return function cleanup() {
      clearTimeout(mouseEnterTimeout);
      if (hoverDiv && hoverDiv.parentNode) {
        hoverDiv.parentNode.removeChild(hoverDiv);
        allHoverDivs.delete(hoverKey);
      }
    };
  }
  
  // Función global para limpiar todos los hover divs huérfanos
  function cleanupAllHovers() {
    allHoverDivs.forEach((hoverDiv, key) => {
      if (hoverDiv && hoverDiv.parentNode) {
        hoverDiv.parentNode.removeChild(hoverDiv);
      }
    });
    allHoverDivs.clear();
  }

  // === FUNCIÓN AUXILIAR PARA ACTUALIZAR CAMPOS DE ARTÍCULO ===
  function actualizarCamposArticulo(item, nombre) {
    if (!nombre || !articulosPorNombre[nombre]) {
      // Si no hay artículo, limpiar campos
      item.codigo = '';
      item.codigoBarras = '';
      item.nombre = '';
      item.valorU = 0;
      item.valorC = 0;
      item.categoria = '';
      item.seleccionado = '';
      item.valorG = 0;
      return;
    }

    const art = articulosPorNombre[nombre];
    const currentTipo = getTipoCliente();

    // Asignar campos básicos
    item.codigo = art[2] || ''; // Código interno (Columna C)
    item.codigoBarras = art[11] || ''; // Código de barras (Columna L)
    item.nombre = art[3] || '';
    item.categoria = art[0] || '';
    item.seleccionado = art[9] || '';

    // Las líneas de devolución/garantía llevan el precio y el costo HISTÓRICOS del pedido
    // original: si se repisaran con el precio de lista de hoy, la diferencia a cobrar sería
    // incorrecta. Se refrescan los datos de catálogo (código, categoría) pero nunca los importes.
    if (esLineaCambio(item)) {
      item.valorG = signoLinea(item) * ((item.valorU || 0) - (item.valorC || 0)) * (item.cantidad || 1);
      return;
    }

    // Asignar valorU según tipo de cliente
      let valorRaw;
      if (currentTipo === 'admin') {
        valorRaw = art[7] || '0';
      } else if (currentTipo === 'consumidor final') {
        valorRaw = art[4] || '0';
      } else {
        valorRaw = art[6] || '0';
      }
      valorRaw = valorRaw.replace(/\$/g, '').replace(/[.,]/g, '');
      item.valorU = parseInt(valorRaw) || 0;
    
    // Asignar valorC desde columna H (índice 7)
    let valorCRaw = art[7] || '0';
    valorCRaw = valorCRaw.replace(/\$/g, '').replace(/[.,]/g, '');
    item.valorC = parseInt(valorCRaw) || 0;

    // Calcular valorG
    item.valorG = (item.valorU - item.valorC) * (item.cantidad || 1);

  }



  // Etiqueta corta del pedido de origen: es el mismo fragmento que se imprime al pie del
  // ticket (últimos 8 caracteres en mayúscula), así el operador lo reconoce de un vistazo.
  function idCortoPedido(id) {
    return id ? String(id).slice(-8).toUpperCase() : '';
  }

  // Texto de la columna "Valor Total" según el tipo de línea.
  function textoTotalLinea(item) {
    if (item.tipoLinea === 'GARANTIA') return 'SIN CARGO';
    const total = totalLinea(item);
    return total.toLocaleString('es-AR', { maximumFractionDigits: 0 });
  }

  // === OPTIMIZACIÓN: CREAR UNA SOLA FILA ===
  function createRowElement(item, idx) {
    const imgs = obtenerImagenesArticulo(item.nombre);
    const primeraImagen = imgs.principal;

    const row = document.createElement('tr');
    row.setAttribute('data-idx', idx);

    // Las líneas de cambio se distinguen por color, distintivo y precio bloqueado: son
    // operaciones que mueven inventario en sentido contrario a la venta habitual.
    const tipo = item.tipoLinea || 'VENTA';
    if (tipo !== 'VENTA') row.className = 'linea-' + tipo.toLowerCase();

    const badge = tipo === 'DEVOLUCION'
      ? '<span class="linea-badge linea-badge-devolucion">↩ Devolución</span>'
      : tipo === 'GARANTIA'
        ? '<span class="linea-badge linea-badge-garantia">⚠ Garantía</span>'
        : '';

    const origen = item.pedidoOrigenId
      ? `<div class="linea-origen">Del pedido <strong>${idCortoPedido(item.pedidoOrigenId)}</strong>${item.motivo ? ' · ' + item.motivo : ''}</div>`
      : '';

    // El importe de una devolución es el que el cliente pagó en su momento: se muestra de
    // solo lectura para que no se pise por error, con un botón para desbloquearlo a mano.
    const valorUAttrs = tipo === 'VENTA' ? '' : 'readonly';
    const lapiz = tipo === 'VENTA'
      ? ''
      : '<button type="button" class="desbloquear-valor-btn" title="Editar el importe histórico">✎</button>';

    row.innerHTML = `
      <td style="text-align:center;">
        ${primeraImagen ? `<img src="${primeraImagen}" class="articulo-img" style="width:50px;height:50px;object-fit:cover;border-radius:4px;cursor:pointer;" alt="Imagen del artículo" ${imgFallbackAttrs(imgs.alt)}>` : '<span style="color:#ccc;">Sin img</span>'}
      </td>
      <td><input type="text" value="${item.codigo || ''}" class="codigo" maxlength="20" style="width:80px" readonly></td>
      <td><div class="nombre-display" style="padding:8px;min-width:220px;">${badge}${item.nombre || ''}${origen}</div></td>
      <td><input type="number" value="${item.cantidad}" class="cantidad" min="1"${item.cupoMaximo ? ' max="' + item.cupoMaximo + '"' : ''} style="width:60px"></td>
        <td><div class="valorU-wrap"><input type="number" value="${item.valorU}" class="valorU" min="0" step="1" style="width:80px" ${valorUAttrs}>${lapiz}</div></td>
      <td class="valorTotal">${textoTotalLinea(item)}</td>
      <td><button type="button" class="remove-btn" data-idx="${idx}" style="background:#d32f2f;color:#fff;border:none;border-radius:4px;width:32px;height:32px;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;" title="Eliminar"><span style="font-weight:bold;font-size:20px;line-height:1;">&times;</span></button></td>
    `;

    return row;
  }

  // === OPTIMIZACIÓN: SETUP DE EVENT LISTENERS PARA UNA FILA ===
  function setupRowEventListeners(row, idx) {
    const imgElement = row.querySelector('.articulo-img');
    
    // Nota: Los botones de eliminar ahora usan event delegation global
    // No se agregan event listeners individuales para evitar problemas con índices
    
    // Configurar efecto hover para imagen con cleanup
    let hoverCleanup = null;
    if (imgElement) {
      const imgs = obtenerImagenesArticulo(items[idx].nombre);
      if (imgs.principal) {
        hoverCleanup = crearHoverImagen(imgElement, imgs.principal, imgs.alt);
      }
    }

    // Retornar función de cleanup
    return { 
      cleanup: function() {
        if (hoverCleanup) hoverCleanup();
      }
    };
  }



  // === OPTIMIZACIÓN: REMOVER ITEM SIN RE-RENDERIZAR TODO ===
  function removeItem(idx) {
    // Validar índice antes de proceder
    if (idx < 0 || idx >= items.length) {
      console.warn(`Índice inválido para eliminar: ${idx}`);
      return;
    }
    
    // Remover del array de items
    items.splice(idx, 1);
    
    // Remover la fila del DOM inmediatamente
    const rowToRemove = itemsBody.querySelector(`tr[data-idx="${idx}"]`);
    if (rowToRemove) {
      rowToRemove.remove();
    }
    
    // Actualizar todos los índices de las filas restantes
    const remainingRows = Array.from(itemsBody.querySelectorAll('tr[data-idx]'));
    
    remainingRows.forEach((row) => {
      const currentIdx = parseInt(row.getAttribute('data-idx'));
      if (currentIdx > idx) {
        const newIdx = currentIdx - 1;
        // Actualizar data-idx de la fila y del botón
        row.setAttribute('data-idx', newIdx);
        const removeBtn = row.querySelector('.remove-btn');
        if (removeBtn) {
          removeBtn.setAttribute('data-idx', newIdx);
        }
      }
    });
    
    // Recalcular totales después de eliminar
    debouncedCalculations();
    // Borrar una devolucion devuelve sus unidades al cupo del pedido original.
    if (typeof refrescarCuposCambio === 'function') refrescarCuposCambio();
  }

  // === DEBOUNCE PARA CÁLCULOS ===
  let calculationTimeout;
  function debouncedCalculations() {
    clearTimeout(calculationTimeout);
    calculationTimeout = setTimeout(() => {
      // Limpiar cache de costos
      costosCache = null;
      lastItemsHash = '';
      
      updateSubtotal();
      calcularTotalFinal();
      actualizarContadoresArticulos();
      actualizarResumenCambio();
      // Nota: acá había una llamada a debouncedRecargoUpdate(), función que quedó dentro
      // del bloque comentado del recargo automático por medio de pago. Al no existir,
      // lanzaba un ReferenceError en cada recálculo y abortaba el resto del callback.
    }, 50);
  }

  // === OPTIMIZACIÓN: ACTUALIZAR SOLO SUBTOTAL ===
  function updateSubtotal() {
    const subtotal = items.reduce((acc, it) => acc + totalLinea(it), 0);
    subtotalInput.value = subtotal.toLocaleString('es-AR', {maximumFractionDigits:0});
  }

  function renderItems() {
    // Limpiar cache al re-renderizar por completo
    costosCache = null;
    lastItemsHash = '';
    
    // Limpiar hovers existentes antes de renderizar
    cleanupAllHovers();
    
    itemsBody.innerHTML = '';
    
    // Usar DocumentFragment para mejor rendimiento
    const fragment = document.createDocumentFragment();
    const setupTasks = []; // Array para tareas asíncronas
    
    items.forEach((item, idx) => {
      const row = createRowElement(item, idx);
      // Orden inverso en pantalla: el agregado mas reciente queda arriba de todo.
      // Solo cambia la POSICION en el DOM; items[] y los data-idx no se tocan, y
      // todo el resto del codigo ubica las filas por data-idx, nunca por posicion.
      fragment.insertBefore(row, fragment.firstChild);
      
      // Guardar tarea de configuración para ejecutar después
      setupTasks.push({
        row,
        idx,
        shouldOpenSelect: idx === items.length - 1 && window._abrirSelect2NuevaFila,
        item
      });
    });
    
    itemsBody.appendChild(fragment);
    
    // Procesar configuraciones en chunks para no bloquear la UI
    function processSetupChunk(startIdx = 0) {
      const chunkSize = 3; // Procesar de a 3 filas por chunk
      const endIdx = Math.min(startIdx + chunkSize, setupTasks.length);
      
      for (let i = startIdx; i < endIdx; i++) {
        const task = setupTasks[i];
        setupRowEventListeners(task.row, task.idx);
        
        // Actualizar campos si hay artículo seleccionado
        if (task.item.nombre && articulosPorNombre[task.item.nombre]) {
          const cantidadOriginal = task.item.cantidad;
          const valorUOriginal = task.item.valorU;
          actualizarCamposArticulo(task.item, task.item.nombre);
          
          if (cantidadOriginal) task.item.cantidad = cantidadOriginal;
          if (valorUOriginal) task.item.valorU = valorUOriginal;
          
          task.item.valorG = signoLinea(task.item) * (task.item.valorU - task.item.valorC) * (task.item.cantidad || 1);

          task.row.querySelector('.valorU').value = task.item.valorU;
          task.row.querySelector('.valorTotal').textContent = textoTotalLinea(task.item);
        }
      }
      
      // Si hay más tareas, procesarlas en el siguiente frame
      if (endIdx < setupTasks.length) {
        requestAnimationFrame(() => processSetupChunk(endIdx));
      } else {
        // Todas las tareas completadas, ejecutar cálculos finales
        debouncedCalculations();
      }
    }
    
    // Iniciar procesamiento asíncrono
    requestAnimationFrame(() => processSetupChunk());
  }

  // === FUNCIÓN PARA ACTUALIZAR CONTADORES DE ARTÍCULOS ===
  function actualizarContadoresArticulos() {
    const contadoresElement = document.getElementById('contadoresArticulos');
    const cantidadArticulosElement = document.getElementById('cantidadArticulos');
    const cantidadUnidadesElement = document.getElementById('cantidadUnidades');
    
    if (!contadoresElement || !cantidadArticulosElement || !cantidadUnidadesElement) return;

    // Filtrar artículos que tienen nombre (están seleccionados)
    const articulosConNombre = items.filter(item => item.nombre && item.nombre.trim() !== '');

    const cantidadArticulosDistintos = articulosConNombre.length;
    const cantidadUnidadesTotales = articulosConNombre.reduce((total, item) => total + (item.cantidad || 0), 0);

    // Los contadores viven en el panel de escaneo y quedan siempre a la vista,
    // incluso en cero, para no mover el layout mientras se carga el pedido.
    cantidadArticulosElement.innerHTML = `<strong>${cantidadArticulosDistintos}</strong> ${cantidadArticulosDistintos === 1 ? 'artículo' : 'artículos'}`;
    cantidadUnidadesElement.innerHTML = `<strong>${cantidadUnidadesTotales}</strong> ${cantidadUnidadesTotales === 1 ? 'unidad' : 'unidades'}`;
  }

  // Formateo numérico para todos los campos relacionados a valores
  function calcularTotalFinal() {
    let subtotal = items.reduce((acc, it) => acc + totalLinea(it), 0);
    // Recargo y descuento porcentuales se aplican SOLO sobre lo que el cliente compra:
    // calcularlos sobre un subtotal ya neteado por devoluciones (que puede ser cero o
    // negativo) daría importes sin sentido o invertidos.
    const baseVenta = items.reduce((acc, it) => acc + (signoLinea(it) > 0 ? totalLinea(it) : 0), 0);
    let recargo = parseInt((recargoInput.value || '0').replace(/\D/g, '')) || 0;
    let descuento = parseInt((descuentoInput.value || '0').replace(/\D/g, '')) || 0;
    let envio = parseInt((envioInput.value || '0').replace(/\D/g, '')) || 0;
    // Si hay porcentaje, calcular recargo automáticamente
    if (recargoPorcentajeInput && recargoPorcentajeInput.value.trim() !== '') {
      let porcentajeR = recargoPorcentajeInput.value.replace(/[^\d.]/g, '');
      porcentajeR = parseFloat(porcentajeR);
      if (!isNaN(porcentajeR) && porcentajeR > 0) {
        recargo = Math.round(baseVenta * (porcentajeR / 100));
        if (recargoInput) {
          recargoInput.value = recargo.toLocaleString('es-AR', {maximumFractionDigits:0});
        }
      } else {
        if (recargoInput) {
          recargoInput.value = '';
        }
      }
    }
    // Si hay porcentaje, calcular descuento automáticamente
    if (descuentoPorcentajeInput && descuentoPorcentajeInput.value.trim() !== '') {
      let porcentaje = descuentoPorcentajeInput.value.replace(/[^\d.]/g, '');
      porcentaje = parseFloat(porcentaje);
      if (!isNaN(porcentaje) && porcentaje > 0) {
        descuento = Math.round(baseVenta * (porcentaje / 100));
        // Actualizar el campo descuento visualmente aunque esté vacío inicialmente
        if (descuentoInput) {
          descuentoInput.value = descuento.toLocaleString('es-AR', {maximumFractionDigits:0});
        }
      } else {
        if (descuentoInput) {
          descuentoInput.value = '';
        }
      }
    }
    let total = subtotal + recargo + envio - descuento;
    // Usar punto como separador de miles para todos los campos
    const formatMiles = n => n ? n.toLocaleString('es-AR').replace(/,/g, '.').replace(/\./g, (m, o, s) => s && s.length > 3 ? '.' : '.') : '';
    // Con líneas de garantía el importe legítimo es CERO: formatMiles devuelve '' para 0 y
    // dejaría el campo en blanco, como si no se hubiera calculado nada. Mientras haya
    // artículos cargados se fuerza el '0' para que el operador vea el total real.
    const formatImporte = n => (n === 0 && items.length > 0) ? '0' : formatMiles(n);
    subtotalInput.value = formatImporte(subtotal);
    recargoInput.value = recargo ? formatMiles(recargo) : '';
    descuentoInput.value = descuento ? formatMiles(descuento) : '';
    envioInput.value = envio ? formatMiles(envio) : '';
    totalFinalInput.value = formatImporte(total);
  }


  // === OPTIMIZACIÓN: AGREGAR ITEM SIN RE-RENDERIZAR TODO ===


  // === LECTOR DE CÓDIGO DE BARRAS + BÚSQUEDA DE ARTÍCULOS ===
  let selectedResultIndex = -1;
  let selectedArticuloNombre = null;
  // Cuando es false (por defecto): la búsqueda es "barcode-first" (solo columna L),
  // y los artículos sin código de barras se hallan por nombre/código.
  // Cuando es true (desbloqueado con contraseña): búsqueda manual completa por nombre.
  let busquedaManualHabilitada = false;
  // Modo Whatsapp: la búsqueda manual queda habilitada de forma indefinida (no se
  // desactiva tras agregar cada artículo). Se desbloquea con la contraseña del modal.
  let busquedaManualPersistente = false;
  const WHATSAPP_MODE_KEY = 'hpModoWhatsapp';
  // Referencias asignadas por el IIFE del modal de contraseña, para poder activar o
  // desactivar la búsqueda manual desde otras partes.
  let desactivarBusquedaManual = null;
  let activarBusquedaManual = null;

  // === CAMBIOS Y DEVOLUCIONES ===
  // Pedido original elegido en el panel y término que se tipeó para encontrarlo; ambos se
  // guardan en el pedido nuevo para poder auditar la operación después.
  let pedidoOrigenSeleccionado = null;   // { id, ...datosDelPedido }
  // Lo asigna el IIFE del panel de cambios. Se llama cada vez que cambian las
  // lineas cargadas (alta, edicion de cantidad o borrado) para que el cupo que
  // muestra el pedido original quede siempre en sincronia con la operacion.
  let refrescarCuposCambio = null;
  let ultimoTerminoBuscado = '';
  // Referencias asignadas por el IIFE del panel de cambios.
  let abrirPanelCambios = null;
  let cerrarPanelCambios = null;

  // Debounce de la búsqueda por tecleo. Vive en el scope del módulo para que el
  // Enter del lector pueda cancelarlo: la pistola teclea el código en pocos ms y
  // dispara Enter mucho antes de que el debounce alcance a renderizar resultados.
  let searchTimeout = null;
  function cancelarBusquedaPendiente() { clearTimeout(searchTimeout); }

  // === ESTADO VISUAL DEL PANEL DE ESCANEO ===
  const scanPanel       = document.getElementById('searchArticulosContainer');
  const scanStatusText  = document.getElementById('scanStatusText');
  const scanNotFound    = document.getElementById('scanNotFound');
  const scanNotFoundCode = document.getElementById('scanNotFoundCode');
  let scanEstadoTimeout = null;
  let catalogoDisponible = true;

  const ESTADO_TEXTOS = {
    pausa: 'Escáner en pausa · Tab para volver',
    listo: 'Escáner listo',
    elegir: 'Elegí el artículo',
    ok: 'Artículo agregado',
    error: 'Código no encontrado',
    'catalogo-error': 'No se pudo cargar el catálogo'
  };

  function estadoBase() {
    if (!catalogoDisponible) return 'catalogo-error';
    return document.activeElement === searchInput ? 'listo' : 'pausa';
  }

  function setEstadoScanner(estado, texto) {
    if (estado === 'catalogo-error') catalogoDisponible = false;
    if (!scanPanel) return;
    clearTimeout(scanEstadoTimeout);
    scanPanel.setAttribute('data-estado', estado);
    if (scanStatusText) scanStatusText.textContent = texto || ESTADO_TEXTOS[estado] || '';
  }

  function refrescarEstadoBase() {
    const base = estadoBase();
    setEstadoScanner(base, ESTADO_TEXTOS[base]);
  }

  // Estados efímeros (ok / error): destellan y vuelven solos al estado base.
  function flashEstadoScanner(estado, texto, ms = 1400) {
    setEstadoScanner(estado, texto);
    scanEstadoTimeout = setTimeout(refrescarEstadoBase, ms);
  }

  function mostrarNoEncontrado(codigo) {
    if (!scanNotFound) return;
    if (scanNotFoundCode) scanNotFoundCode.textContent = codigo;
    scanNotFound.classList.add('visible');
  }

  function ocultarNoEncontrado() {
    if (scanNotFound) scanNotFound.classList.remove('visible');
  }

  // Resuelve un texto como código exacto. Devuelve true si ya actuó sobre él.
  // Es la única ruta "escanear → agregar" en un solo paso.
  function procesarEscaneo(texto) {
    const matches = resolverCodigoEscaneado(texto);
    if (matches.length === 0) return false;

    ocultarNoEncontrado();

    if (matches.length === 1) {
      addArticuloFromSearch(matches[0][3]);
      return true;
    }

    // Un mismo código de barras puede pertenecer a varios artículos: se listan
    // para elegir en vez de arriesgar cargar el equivocado.
    renderResultados(matches);
    selectedResultIndex = 0;
    updateSelectedResult(searchResults.querySelectorAll('.search-result-item'));
    setEstadoScanner('elegir', `${matches.length} artículos con ese código`);
    return true;
  }

  // Punto único de confirmación del buscador: lo usan el Enter del lector y el
  // botón Agregar, para que ambos resuelvan un código exactamente igual.
  function confirmarBusqueda() {
    // El lector dispara Enter apenas termina de teclear: hay que descartar la
    // búsqueda diferida, que todavía no alcanzó a renderizar resultados.
    cancelarBusquedaPendiente();

    const resultItems = searchResults.querySelectorAll('.search-result-item');

    // 1) Si ya se eligió una fila del desplegable con las flechas, respetarla.
    if (selectedResultIndex >= 0 && resultItems[selectedResultIndex]) {
      selectArticuloAndFocusQuantity(resultItems[selectedResultIndex]);
      return;
    }

    const texto = searchInput.value.trim();
    if (!texto) return;

    // 2) Coincidencia exacta de código: escaneo resuelto en un solo paso.
    if (procesarEscaneo(texto)) return;

    // 3) Tecleo humano con resultados a la vista: comportamiento de siempre.
    if (resultItems[0]) {
      selectArticuloAndFocusQuantity(resultItems[0]);
      return;
    }

    // 4) Nada coincide: avisar sin cortar el ritmo y dejar el texto seleccionado
    // para que el próximo escaneo lo reemplace de una.
    mostrarNoEncontrado(texto);
    showScanError(texto);
    flashEstadoScanner('error', 'Código no encontrado');
    searchInput.focus();
    searchInput.select();
  }

  function initializeSearchArticulos() {
    if (!searchInput || !searchResults) return;

    refrescarEstadoBase();

    // Configurar evento de input para búsqueda en tiempo real
    searchInput.addEventListener('input', function() {
      cancelarBusquedaPendiente();
      const query = this.value.trim().toLowerCase();

      // Limpiar selección previa al escribir
      selectedArticuloNombre = null;
      if (!this.value) ocultarNoEncontrado();

      if (query.length < 2) {
        searchResults.style.display = 'none';
        searchResults.innerHTML = '';
        selectedResultIndex = -1;
        return;
      }

      // Debounce para evitar búsquedas excesivas
      searchTimeout = setTimeout(() => {
        performSearch(query);
        selectedResultIndex = -1;
      }, 200);
    });

    searchInput.addEventListener('focus', refrescarEstadoBase);
    // El estado depende del nuevo activeElement, que recién se conoce tras el blur.
    searchInput.addEventListener('blur', () => setTimeout(refrescarEstadoBase, 0));

    // Navegación con teclado en el campo de búsqueda
    searchInput.addEventListener('keydown', function(e) {
      const resultItems = searchResults.querySelectorAll('.search-result-item');

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (resultItems.length > 0) {
          selectedResultIndex = Math.min(selectedResultIndex + 1, resultItems.length - 1);
          updateSelectedResult(resultItems);
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (resultItems.length > 0) {
          selectedResultIndex = Math.max(selectedResultIndex - 1, 0);
          updateSelectedResult(resultItems);
        }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        confirmarBusqueda();
      } else if (e.key === 'Escape') {
        searchResults.style.display = 'none';
        searchResults.innerHTML = '';
        selectedResultIndex = -1;
        selectedArticuloNombre = null;
        ocultarNoEncontrado();
        refrescarEstadoBase();
      }
    });

    // Enter en campo cantidad para agregar artículo
    if (searchQuantity) {
      searchQuantity.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (selectedArticuloNombre) {
            addArticuloFromSearch(selectedArticuloNombre);
          }
        }
      });
      
      searchQuantity.addEventListener('input', function() {
        let value = parseInt(this.value) || 1;
        if (value < 1) value = 1;
        if (value > 999) value = 999;
        this.value = value;
      });
      
      searchQuantity.addEventListener('focus', function() {
        this.select();
      });
    }
    
    // Botón de agregar: misma resolución que el Enter del buscador, para que un
    // código tipeado sin elegir del desplegable también se cargue.
    if (addSearchItemBtn) {
      addSearchItemBtn.addEventListener('click', function() {
        if (selectedArticuloNombre) {
          addArticuloFromSearch(selectedArticuloNombre);
          return;
        }
        confirmarBusqueda();
      });
    }
    
    // Cerrar resultados al hacer clic fuera
    document.addEventListener('click', function(e) {
      if (!searchInput.contains(e.target) && !searchResults.contains(e.target)) {
        searchResults.style.display = 'none';
        selectedResultIndex = -1;
      }
    });

    // Tab (desde cualquier parte) posiciona el cursor en la búsqueda de artículos.
    // Facilita el flujo con lector de código de barras.
    document.addEventListener('keydown', function(e) {
      if (e.key !== 'Tab' || e.shiftKey) return;
      // No interferir si ya se está escribiendo en el propio buscador.
      if (document.activeElement === searchInput) return;
      e.preventDefault();
      searchInput.focus();
      searchInput.select();
    });

    // El banner de "sin coincidencias" reutiliza el flujo del candado, que ya
    // decide entre pedir la contraseña o activar directo en modo Whatsapp.
    const scanNotFoundBtn = document.getElementById('scanNotFoundBtn');
    if (scanNotFoundBtn) {
      scanNotFoundBtn.addEventListener('click', function() {
        const manualBtn = document.getElementById('manualSearchBtn');
        if (manualBtn && !busquedaManualHabilitada) manualBtn.click();
        ocultarNoEncontrado();
        searchInput.focus();
        searchInput.select();
      });
    }

    initCapturaEscaneoGlobal();

    // Al abrir/cargar la página, posicionar el cursor en la búsqueda de artículos.
    setTimeout(() => searchInput.focus(), 100);
  }

  // === CAPTURA GLOBAL DEL LECTOR (detección de ráfaga) ===
  // La pistola teclea mucho más rápido que una persona. Si esa ráfaga aparece
  // mientras el foco está en otro campo, el código se desvía al buscador y el
  // campo que se estaba editando se restaura intacto.
  const RAFAGA_MS = 30;          // separación máxima entre teclas del lector
  const RAFAGA_MIN_CHARS = 4;    // caracteres rápidos seguidos antes de dar por iniciada la ráfaga
  const RAFAGA_TIMEOUT_MS = 150; // sin teclas por más de esto, el buffer se descarta

  // El lector antepone Shift a cada mayúscula del código (y algunos alternan
  // CapsLock entre caracteres). Esos keydown no aportan texto: hay que dejarlos
  // pasar sin tocar el buffer ni el reloj de la ráfaga. Si reiniciaran la
  // secuencia, el código llegaría partido y sólo entraría el tramo posterior al
  // último modificador (p. ej. "MRQI93881" se cargaba como "I93881").
  const TECLAS_MODIFICADORAS = ['Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'OS', 'CapsLock', 'NumLock', 'ScrollLock'];

  // Nunca interceptar mientras haya un modal abierto ni sobre campos sensibles:
  // ahí las pulsaciones son contraseñas o montos, no códigos de artículo.
  const OVERLAYS_BLOQUEANTES = ['loginOverlay', 'adminPassOverlay', 'manualPassOverlay', 'calcCobroOverlay', 'confirmarCambioOverlay'];
  const CAMPOS_PROTEGIDOS = ['loginEmail', 'loginPassword', 'adminPassInput', 'manualPassInput', 'calcAbona', 'cambiosBuscarInput'];

  // Los overlays se abren y cierran vía style.display inline, así que
  // alcanza con leer esa propiedad: se evita un getComputedStyle por pulsación.
  let overlaysCache = null;
  function hayOverlayAbierto() {
    if (!overlaysCache) {
      overlaysCache = OVERLAYS_BLOQUEANTES.map(id => document.getElementById(id)).filter(Boolean);
    }
    return overlaysCache.some(el => el.style.display && el.style.display !== 'none');
  }

  function initCapturaEscaneoGlobal() {
    let buffer = '';
    let ultimaTecla = 0;
    let enRafaga = false;
    let snapshot = null;        // estado del campo antes del primer carácter de la secuencia
    let campoSecuencia = null;  // elemento sobre el que arrancó la secuencia actual
    let desviado = false;       // true si movimos el foco desde otro campo
    let capturando = false;     // true si escribimos el código a mano en el buscador
    let resetTimer = null;

    function capturarSnapshot(el) {
      if (!el) return null;
      if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') return null;
      // input[type=number] (Cantidad) lanza al leer selectionStart: en ese caso
      // se trabaja sobre el final del valor.
      let selStart, selEnd;
      try { selStart = el.selectionStart; selEnd = el.selectionEnd; } catch (_) {}
      if (selStart == null || selEnd == null) selStart = selEnd = String(el.value).length;
      return { el, value: el.value, selStart, selEnd };
    }

    function restaurarSnapshot() {
      if (!snapshot) return;
      const { el, value, selStart, selEnd } = snapshot;
      el.value = value;
      try { el.setSelectionRange(selStart, selEnd); } catch (_) {}
    }

    function reset() {
      clearTimeout(resetTimer);
      buffer = '';
      enRafaga = false;
      desviado = false;
      capturando = false;
      snapshot = null;
      campoSecuencia = null;
    }

    // Deja el buscador como recién abierto, sin lanzar la búsqueda diferida: el
    // Enter del lector resuelve el código completo unos milisegundos después.
    function limpiarBuscadorParaEscaneo() {
      cancelarBusquedaPendiente();
      searchInput.value = '';
      selectedArticuloNombre = null;
      selectedResultIndex = -1;
      if (searchResults) {
        searchResults.style.display = 'none';
        searchResults.innerHTML = '';
      }
      ocultarNoEncontrado();
    }

    // Falso positivo (un tecleo humano muy veloz que nunca terminó en Enter):
    // devolvemos el texto y el foco al campo donde se estaba escribiendo. Si la
    // ráfaga arrancó sobre el propio buscador, se repone lo que había antes de
    // limpiarlo, con lo tecleado insertado donde estaba el cursor.
    function deshacerCaptura() {
      if (!capturando || !snapshot) { reset(); return; }
      const { el, value, selStart, selEnd } = snapshot;
      const escrito = searchInput.value;
      searchInput.value = '';
      el.value = value.slice(0, selStart) + escrito + value.slice(selEnd);
      el.focus();
      const pos = selStart + escrito.length;
      try { el.setSelectionRange(pos, pos); } catch (_) {}
      el.dispatchEvent(new Event('input', { bubbles: true }));
      reset();
    }

    document.addEventListener('keydown', function(e) {
      if (hayOverlayAbierto()) { reset(); return; }

      const activo = document.activeElement;
      if (activo && CAMPOS_PROTEGIDOS.includes(activo.id)) { reset(); return; }

      // Modificadora sola: no es un carácter del código, se ignora por completo.
      if (TECLAS_MODIFICADORAS.includes(e.key)) return;

      const ahora = e.timeStamp || Date.now();
      const delta = ahora - ultimaTecla;
      ultimaTecla = ahora;

      if (e.key === 'Enter') {
        // El lector cierra con Enter; el handler del buscador se encarga del resto.
        clearTimeout(resetTimer);
        reset();
        return;
      }

      if (e.key.length !== 1 || e.ctrlKey || e.altKey || e.metaKey) {
        clearTimeout(resetTimer);
        reset();
        return;
      }

      // Arranca una secuencia nueva si hubo una pausa, si el buffer quedó vacío
      // (el escaneo anterior ya se resolvió con Enter) o si cambió el campo con
      // foco. En ese instante el campo todavía está limpio, porque estamos en
      // fase de captura y la pulsación aún no se insertó.
      if (delta > RAFAGA_MS || buffer === '' || campoSecuencia !== activo) {
        buffer = e.key;
        enRafaga = false;
        desviado = false;
        campoSecuencia = activo;
        snapshot = capturarSnapshot(activo);
      } else {
        buffer += e.key;
      }

      if (!enRafaga && buffer.length >= RAFAGA_MIN_CHARS) {
        enRafaga = true;
        if (activo !== searchInput) {
          // Puede no haber snapshot (el foco estaba en el body o en un select):
          // en ese caso no hay nada que devolver, solo se desvía el código.
          if (snapshot) restaurarSnapshot();
          searchInput.focus();
          desviado = true;
          // El foco pasó al buscador: la secuencia continúa ahí, no se reinicia.
          campoSecuencia = searchInput;
        }
        // El código escaneado reemplaza SIEMPRE lo que hubiera en el buscador:
        // concatenarlo a un texto previo (una búsqueda a mano sin borrar, o el
        // nombre del artículo elegido en el escaneo anterior) deja una consulta
        // que no coincide con nada.
        limpiarBuscadorParaEscaneo();
        capturando = true;
      }

      // Durante la ráfaga escribimos el buffer a mano para que ningún carácter
      // quede en el campo equivocado ni se sume al contenido anterior.
      if (capturando) {
        e.preventDefault();
        searchInput.value = buffer;
        try { searchInput.setSelectionRange(buffer.length, buffer.length); } catch (_) {}
      }

      clearTimeout(resetTimer);
      resetTimer = setTimeout(deshacerCaptura, RAFAGA_TIMEOUT_MS);
    }, true);
  }
  
  function selectArticuloAndFocusQuantity(resultItem) {
    const nombreArticulo = resultItem.getAttribute('data-nombre');
    selectedArticuloNombre = nombreArticulo;
    
    // Actualizar el campo de búsqueda con el nombre del artículo
    if (searchInput) {
      searchInput.value = nombreArticulo;
    }
    
    // Ocultar resultados
    if (searchResults) {
      searchResults.style.display = 'none';
      searchResults.innerHTML = '';
    }
    
    // Enfocar campo cantidad
    if (searchQuantity) {
      searchQuantity.focus();
      searchQuantity.select();
    }
  }
  
  function updateSelectedResult(resultItems) {
    // Remover clase de todos los items
    resultItems.forEach((item, idx) => {
      item.classList.remove('keyboard-selected');
      if (idx === selectedResultIndex) {
        item.classList.add('keyboard-selected');
        // Scroll automático para mantener el item visible
        item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    });
  }
  
  function performSearch(query) {
    if (!searchResults) return;
    
    // El query ya viene en minúsculas (ver initializeSearchArticulos)
    const q = query;
    const results = articulosDisponibles.filter(art => {
      const barras = (art[11] || '').toLowerCase(); // Columna L (código de barras)
      const nombre = (art[3] || '').toLowerCase();  // Columna D (nombre)
      const codC   = (art[2] || '').toLowerCase();  // Columna C (código interno)
      const codA   = (art[0] || '').toLowerCase();  // Columna A (código)

      if (busquedaManualHabilitada) {
        // Modo manual: búsqueda completa sin restricciones (nombre + código + barras)
        return nombre.includes(q) || codC.includes(q) || codA.includes(q) || barras.includes(q);
      }

      // Modo por defecto (barcode-first):
      // - Si el artículo TIENE código de barras (col L), solo se halla por ese dato.
      // - Si NO tiene código de barras (col L vacía), se permite buscar por nombre/código.
      if (barras) return barras.includes(q);
      return nombre.includes(q) || codC.includes(q) || codA.includes(q);
    }).slice(0, 50).reverse(); // Limitar a 50 resultados e invertir orden

    renderResultados(results);
  }

  // Pinta una lista de artículos en el desplegable. Se usa tanto para la búsqueda
  // por tecleo como para los candidatos de un código de barras compartido.
  function renderResultados(results) {
    if (!searchResults) return;

    if (results.length === 0) {
      searchResults.innerHTML = '<div class="search-no-results">No se encontraron resultados</div>';
      searchResults.style.display = 'block';
      return;
    }

    // Renderizar resultados
    searchResults.innerHTML = results.map(art => {
      const codigo = art[2] || '';
      const nombre = art[3] || '';
      const imgs = imagenesDeStr(art[1] || '');
      const imagenUrl = imgs.principal;

      return `
        <div class="search-result-item" data-nombre="${nombre}">
          ${imagenUrl ? `<img src="${imagenUrl}" class="search-result-img" alt="${nombre}" ${imgFallbackAttrs(imgs.alt)}>` : '<div class="search-result-img-placeholder"></div>'}
          <div class="search-result-info">
            <div class="search-result-name">${nombre}</div>
            <div class="search-result-code">Código: ${codigo}</div>
          </div>
        </div>
      `;
    }).join('');
    
    searchResults.style.display = 'block';
    
    // Agregar event listeners a los resultados
    searchResults.querySelectorAll('.search-result-item').forEach((item, idx) => {
      item.addEventListener('click', function() {
        selectArticuloAndFocusQuantity(this);
      });
      
      // Actualizar índice seleccionado al pasar el mouse
      item.addEventListener('mouseenter', function() {
        selectedResultIndex = idx;
        updateSelectedResult(searchResults.querySelectorAll('.search-result-item'));
      });
    });
  }
  
  function addArticuloFromSearch(nombreArticulo) {
    if (!nombreArticulo || !articulosPorNombre[nombreArticulo]) {
      return;
    }
    
    const articulo = articulosPorNombre[nombreArticulo];
    
    // Obtener cantidad especificada
    const cantidadEspecificada = searchQuantity ? (parseInt(searchQuantity.value) || 1) : 1;
    
    // Verificar disponibilidad
    if (articulo[4]?.toLowerCase() === 'no disponible') {
      showPopup(`⚠️ El artículo "${nombreArticulo}" no está disponible.`, '⚠️', false);
      return;
    }
    
    // Verificar si el artículo ya existe en la lista.
    // Solo se fusiona con otra línea de VENTA: una devolución del mismo artículo es una
    // operación distinta (movimiento ENTRADA, precio histórico) y debe quedar separada.
    const existingItemIndex = items.findIndex(item => item.nombre === nombreArticulo && !esLineaCambio(item));

    if (existingItemIndex !== -1) {
      // Incrementar cantidad del artículo existente
      items[existingItemIndex].cantidad += cantidadEspecificada;
      
      // Actualizar la fila visualmente
      const existingRow = itemsBody.querySelector(`tr[data-idx="${existingItemIndex}"]`);
      if (existingRow) {
        const cantidadInput = existingRow.querySelector('.cantidad');
        const valorTotalCell = existingRow.querySelector('.valorTotal');
        
        if (cantidadInput) {
          cantidadInput.value = items[existingItemIndex].cantidad;
        }
        
        if (valorTotalCell) {
          valorTotalCell.textContent = textoTotalLinea(items[existingItemIndex]);
        }

        // Actualizar valorG
        if (items[existingItemIndex].valorC) {
          items[existingItemIndex].valorG = signoLinea(items[existingItemIndex]) * (items[existingItemIndex].valorU - items[existingItemIndex].valorC) * items[existingItemIndex].cantidad;
        }

        // Highlight temporal de la fila
        existingRow.style.backgroundColor = '#e8f5e8';
        setTimeout(() => {
          existingRow.style.backgroundColor = '';
        }, 1500);
        traerFilaALaVista(existingRow);
      }

      // Sin toast: la confirmación ya la dan el destello verde de la fila y el
      // estado "✓ <articulo>" del panel de escaneo, sin crear nodos ni descargar
      // la imagen del articulo en cada lectura.
    } else {
      // Agregar nuevo artículo
      const newItem = {
        codigo: '',
        codigoBarras: '',
        nombre: nombreArticulo,
        cantidad: cantidadEspecificada,
        valorU: 0,
        valorC: 0,
        categoria: '',
        seleccionado: '',
        valorG: 0
      };
      
      // Actualizar campos del artículo
      actualizarCamposArticulo(newItem, nombreArticulo);
      
      // Restaurar cantidad especificada
      newItem.cantidad = cantidadEspecificada;
      
      // Recalcular valorG
      newItem.valorG = (newItem.valorU - newItem.valorC) * newItem.cantidad;
      
      items.push(newItem);
      const newIdx = items.length - 1;
      const row = createRowElement(newItem, newIdx);
      // Arriba de todo: lo recien escaneado es lo que el operador necesita ver.
      itemsBody.insertBefore(row, itemsBody.firstChild);
      
      // Configurar event listeners para la nueva fila
      setupRowEventListeners(row, newIdx);
      
      // Highlight temporal de la nueva fila
      row.style.backgroundColor = '#e8f5e8';
      setTimeout(() => {
        row.style.backgroundColor = '';
      }, 1500);
      traerFilaALaVista(row);

    }

    // Recalcular totales
    debouncedCalculations();

    // La búsqueda manual es de un solo uso: se desactiva tras agregar cada artículo
    // para evitar el abuso de esta función de emergencia. En modo Whatsapp queda fija.
    if (busquedaManualHabilitada && !busquedaManualPersistente &&
        typeof desactivarBusquedaManual === 'function') {
      desactivarBusquedaManual();
    }

    // Limpiar búsqueda (re-enfoca el buscador, listo para el próximo escaneo)
    clearSearch();

    // El destello va después de clearSearch: el focus() que hace allí dispara
    // refrescarEstadoBase y borraría el estado de éxito si se pintara antes.
    flashEstadoScanner('ok', `✓ ${nombreArticulo}`);
  }

  // === ALTA DE LÍNEAS DE CAMBIO (DEVOLUCION / GARANTIA) ===
  // A diferencia de addArticuloFromSearch, acá el precio y el costo NO salen del catálogo:
  // vienen del pedido original, porque la diferencia a cobrar se calcula contra lo que el
  // cliente pagó realmente, no contra el precio de lista de hoy.
  function agregarLineaCambio(datos) {
    const { tipoLinea, nombre, codigo, codigoBarras, cantidad, valorU, valorC,
            categoria, seleccionado, pedidoOrigenId, motivo, valorULista, cupoMaximo } = datos;

    // Tope duro de la linea: unidades del pedido original todavia disponibles
    // (lo comprado menos lo ya procesado en cambios anteriores). Sin el no se
    // aplica limite, para no romper la edicion de pedidos de cambio antiguos.
    const tope = parseInt(cupoMaximo, 10) || 0;
    let cant = Math.max(1, parseInt(cantidad, 10) || 1);
    if (tope > 0 && cant > tope) cant = tope;

    // Fusionar solo con una línea equivalente: mismo artículo, mismo tipo y mismo pedido origen.
    const idxExistente = items.findIndex(it =>
      it.nombre === nombre &&
      it.tipoLinea === tipoLinea &&
      it.pedidoOrigenId === pedidoOrigenId
    );

    if (idxExistente !== -1) {
      // Nunca por encima del tope: varios clicks seguidos en "Devolucion" suman
      // sobre la misma linea y ahi es donde se descontaba de mas por error.
      const topeLinea = parseInt(items[idxExistente].cupoMaximo, 10) || 0;
      const sumada = items[idxExistente].cantidad + cant;
      items[idxExistente].cantidad = topeLinea > 0 ? Math.min(topeLinea, sumada) : sumada;
      items[idxExistente].valorG = signoLinea(items[idxExistente]) *
        (items[idxExistente].valorU - items[idxExistente].valorC) * items[idxExistente].cantidad;

      const filaExistente = itemsBody.querySelector(`tr[data-idx="${idxExistente}"]`);
      if (filaExistente) {
        const inputCant = filaExistente.querySelector('.cantidad');
        if (inputCant) inputCant.value = items[idxExistente].cantidad;
        const celdaTotal = filaExistente.querySelector('.valorTotal');
        if (celdaTotal) celdaTotal.textContent = textoTotalLinea(items[idxExistente]);
        traerFilaALaVista(filaExistente);
      }
    } else {
      // GARANTIA es una reposición sin cargo: no aporta importe ni costo (signoLinea = 0),
      // pero se conserva valorU para dejar registrado a cuánto se había vendido la unidad.
      const nuevo = {
        codigo: codigo || '',
        codigoBarras: codigoBarras || '',
        nombre: nombre,
        cantidad: cant,
        valorU: Math.abs(parseInt(valorU, 10) || 0),
        valorC: Math.abs(parseInt(valorC, 10) || 0),
        categoria: categoria || '',
        seleccionado: seleccionado || '',
        valorG: 0,
        tipoLinea: tipoLinea,
        pedidoOrigenId: pedidoOrigenId || '',
        motivo: motivo || (tipoLinea === 'GARANTIA' ? 'Falla' : 'Devolución')
      };
      // Cuando el importe se neteó por el descuento del pedido original se guarda también
      // el precio de lista de aquella venta: sin él la devolución no sería auditable.
      const lista = Math.abs(parseInt(valorULista, 10) || 0);
      if (lista && lista !== nuevo.valorU) nuevo.valorULista = lista;
      // Campo interno: acompania a la linea para poder topear la cantidad tambien
      // cuando se edita a mano en la tabla. No se serializa a Firebase ni al ticket.
      if (tope > 0) nuevo.cupoMaximo = tope;
      nuevo.valorG = signoLinea(nuevo) * (nuevo.valorU - nuevo.valorC) * nuevo.cantidad;

      items.push(nuevo);
      const idx = items.length - 1;
      const fila = createRowElement(nuevo, idx);
      itemsBody.insertBefore(fila, itemsBody.firstChild);
      setupRowEventListeners(fila, idx);
      traerFilaALaVista(fila);
    }

    debouncedCalculations();
    if (typeof refrescarCuposCambio === 'function') refrescarCuposCambio();
  }

  // Marca del pedido como operación de cambio. Devuelve {} en una venta normal para que el
  // nodo de Firebase quede exactamente igual que antes de esta funcionalidad.
  function datosOperacionCambio() {
    const lineas = items.filter(esLineaCambio);
    if (lineas.length === 0) return {};
    const origenes = [...new Set(lineas.map(it => it.pedidoOrigenId).filter(Boolean))];
    return {
      tipoOperacion: 'CAMBIO',
      cambio: {
        pedidoOrigenId: origenes[0] || '',
        // Un mismo cambio puede tocar más de un pedido anterior
        ...(origenes.length > 1 ? { pedidosOrigen: origenes } : {}),
        fechaOrigen: (pedidoOrigenSeleccionado && pedidoOrigenSeleccionado.fecha) || '',
        buscadoPor: ultimoTerminoBuscado || ''
      }
    };
  }

  const formatoPesos = n => (n < 0 ? '-$ ' : '$ ') + Math.abs(Math.round(n)).toLocaleString('es-AR');

  // Deja la interfaz lista para la próxima operación: sin pedido de origen colgado ni
  // resumen de diferencia de la orden anterior.
  function limpiarEstadoCambios() {
    pedidoOrigenSeleccionado = null;
    ultimoTerminoBuscado = '';
    const buscador = document.getElementById('cambiosBuscarInput');
    if (buscador) buscador.value = '';
    const origen = document.getElementById('cambiosOrigen');
    if (origen) { origen.innerHTML = ''; origen.hidden = true; }
    const resumen = document.getElementById('cambioResumen');
    if (resumen) resumen.hidden = true;
    const lblTotal = document.getElementById('totalFinalLabel');
    if (lblTotal) lblTotal.innerHTML = '<strong>Total Final</strong>';
    const lblMedio = document.getElementById('medioPagoLabel');
    if (lblMedio) lblMedio.textContent = 'Medio de Pago*';
    if (typeof cerrarPanelCambios === 'function') cerrarPanelCambios();
  }

  // Resumen de la operación: cuánto se devuelve, cuánto se lleva y cuál es la diferencia.
  // Se mantiene oculto en las ventas normales para no agregar ruido al flujo de siempre.
  function actualizarResumenCambio() {
    const caja = document.getElementById('cambioResumen');
    if (!caja) return;

    const lineas = items.filter(esLineaCambio);
    if (lineas.length === 0) {
      caja.hidden = true;
      const lblTotal = document.getElementById('totalFinalLabel');
      if (lblTotal) lblTotal.innerHTML = '<strong>Total Final</strong>';
      const lblMedio = document.getElementById('medioPagoLabel');
      if (lblMedio) lblMedio.textContent = 'Medio de Pago*';
      return;
    }

    const devoluciones = items.reduce((acc, it) => acc + (signoLinea(it) < 0 ? totalLinea(it) : 0), 0);
    const ventas = items.reduce((acc, it) => acc + (signoLinea(it) > 0 ? totalLinea(it) : 0), 0);
    const diferencia = parseImporte(totalFinalInput.value);

    document.getElementById('cambioResumenDevoluciones').textContent = formatoPesos(devoluciones);
    document.getElementById('cambioResumenVentas').textContent = '+' + formatoPesos(ventas);

    // La diferencia (a cobrar/a devolver) ya no se pinta acá: vive únicamente
    // en el Total Final del pie, para no repetir el mismo dato dos veces.
    let texto;
    if (diferencia > 0)      { texto = 'Diferencia a cobrar'; }
    else if (diferencia < 0) { texto = 'A devolver al cliente'; }
    else                     { texto = 'Sin diferencia'; }

    caja.hidden = false;

    // El rótulo del total y del medio de pago acompañan al signo de la operación
    const lblTotal = document.getElementById('totalFinalLabel');
    if (lblTotal) lblTotal.innerHTML = '<strong>' + texto + '</strong>';
    const lblMedio = document.getElementById('medioPagoLabel');
    if (lblMedio) lblMedio.textContent = diferencia < 0 ? 'Medio de devolución*' : 'Medio de Pago*';

    // Una operación sin diferencia no se cobra: se propone "Sin cargo" si no eligieron otro
    if (diferencia === 0 && form.medioPago && !form.medioPago.value) {
      form.medioPago.value = 'Sin cargo';
    }
  }

  // Con listas largas el resaltado de la fila no se ve si quedó fuera de pantalla.
  function traerFilaALaVista(row) {
    if (!row || typeof row.getBoundingClientRect !== 'function') return;
    const rect = row.getBoundingClientRect();
    const visible = rect.top >= 0 && rect.bottom <= (window.innerHeight || document.documentElement.clientHeight);
    if (!visible) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function clearSearch() {
    if (searchInput) {
      searchInput.value = '';
    }
    if (searchResults) {
      searchResults.style.display = 'none';
      searchResults.innerHTML = '';
    }
    if (searchQuantity) {
      searchQuantity.value = 1;
    }
    selectedResultIndex = -1;
    selectedArticuloNombre = null;
    // Volver a enfocar el campo de búsqueda
    if (searchInput) {
      searchInput.focus();
    }
  }

  // === TOASTS DE ESCANEO (compactos y apilables) ===
  // Al escanear en serie llegan varias confirmaciones seguidas: se apilan y duran
  // poco, para confirmar sin tapar la tabla de artículos.
  const TOAST_MAX = 3;
  const TOAST_MS = 2000;

  function getToastStack() {
    let stack = document.getElementById('scanToastStack');
    if (stack) return stack;

    if (!document.getElementById('scanToastStyles')) {
      const style = document.createElement('style');
      style.id = 'scanToastStyles';
      style.textContent = `
        #scanToastStack {
          position: fixed; top: 20px; right: 20px; z-index: 10000;
          display: flex; flex-direction: column; gap: 10px;
          pointer-events: none;
        }
        .scan-toast {
          display: flex; align-items: center; gap: 12px;
          min-width: 290px; max-width: 380px;
          padding: 12px 14px; background: #fff;
          border-radius: 12px; border-left: 4px solid #28a745;
          box-shadow: 0 8px 28px rgba(15, 23, 42, .18);
          animation: slideIn .22s ease-out;
          pointer-events: auto; cursor: pointer;
        }
        .scan-toast.error { border-left-color: #dc2626; }
        .scan-toast-img {
          width: 56px; height: 56px; object-fit: cover;
          border-radius: 8px; flex-shrink: 0; background: #f1f5f9;
        }
        .scan-toast-body { flex: 1; min-width: 0; }
        .scan-toast-accion {
          font-size: 12px; font-weight: 700; color: #28a745;
          text-transform: uppercase; letter-spacing: .3px; margin-bottom: 3px;
        }
        .scan-toast.error .scan-toast-accion { color: #dc2626; }
        .scan-toast-nombre {
          font-size: 14px; font-weight: 600; color: #1e293b; line-height: 1.3;
          display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .scan-toast-cant {
          flex-shrink: 0; align-self: center;
          font-size: 15px; font-weight: 700; color: #fff; background: #28a745;
          border-radius: 999px; padding: 3px 11px;
        }
        @keyframes slideIn {
          from { transform: translateX(420px); opacity: 0; }
          to   { transform: translateX(0); opacity: 1; }
        }
        @keyframes slideOut {
          from { transform: translateX(0); opacity: 1; }
          to   { transform: translateX(420px); opacity: 0; }
        }
      `;
      document.head.appendChild(style);
    }

    stack = document.createElement('div');
    stack.id = 'scanToastStack';
    document.body.appendChild(stack);
    return stack;
  }

  // El remove() real se difiere hasta que termina la animación de salida, así que
  // el toast sigue en el DOM ~220 ms despues de cerrarlo. La marca `cerrando`
  // evita re-cerrarlo y, sobre todo, deja contarlo aparte en pushToast.
  function cerrarToast(toast) {
    if (!toast || !toast.parentNode || toast.dataset.cerrando === '1') return;
    toast.dataset.cerrando = '1';
    if (toast._timerCierre) { clearTimeout(toast._timerCierre); toast._timerCierre = null; }
    toast.style.animation = 'slideOut .22s ease-in';
    setTimeout(() => toast.remove(), 220);
  }

  function pushToast(toast) {
    const stack = getToastStack();
    stack.appendChild(toast);

    // Retirar los más viejos si se acumulan. Solo cuentan los que NO están
    // saliendo: cerrarToast no borra el nodo en el acto (espera la animación),
    // así que un `while` sobre stack.children nunca ve bajar el contador y
    // cuelga la pestaña al escanear varios códigos seguidos.
    const vivos = [];
    for (const el of stack.children) {
      if (el.dataset.cerrando !== '1') vivos.push(el);
    }
    for (let i = 0; i < vivos.length - TOAST_MAX; i++) cerrarToast(vivos[i]);

    toast.addEventListener('click', () => cerrarToast(toast));
    toast._timerCierre = setTimeout(() => cerrarToast(toast), TOAST_MS);
  }

  function showScanError(codigo) {
    const toast = document.createElement('div');
    toast.className = 'scan-toast error';
    toast.innerHTML = `
      <div class="scan-toast-body">
        <div class="scan-toast-accion">Sin coincidencias</div>
        <div class="scan-toast-nombre">${codigo}</div>
      </div>
    `;
    pushToast(toast);
  }

  // === EVENT DELEGATION PARA BOTONES DE ELIMINAR ===
  itemsBody.addEventListener('click', function(e) {
    // Verificar si se hizo clic en el botón de eliminar o su contenido
    const removeBtn = e.target.closest('.remove-btn');
    if (removeBtn) {
      const row = removeBtn.closest('tr');
      if (row) {
        const idx = parseInt(row.getAttribute('data-idx'));
        if (idx >= 0 && idx < items.length) {
          removeItem(idx);
        }
      }
    }

    // Desbloqueo puntual del importe histórico de una línea de cambio
    const editarBtn = e.target.closest('.desbloquear-valor-btn');
    if (editarBtn) {
      const input = editarBtn.parentNode.querySelector('.valorU');
      if (input) {
        input.readOnly = false;
        editarBtn.remove();
        input.focus();
        input.select();
      }
    }
  });

  // Unidades del mismo articulo y pedido origen ya comprometidas en OTRAS lineas
  // de cambio (devolucion y garantia comparten el cupo del pedido original).
  function unidadesCambioEnOtrasLineas(idxActual) {
    const ref = items[idxActual];
    if (!ref) return 0;
    return items.reduce((acc, ln, i) => {
      if (i === idxActual || !esLineaCambio(ln)) return acc;
      if ((ln.pedidoOrigenId || '') !== (ref.pedidoOrigenId || '')) return acc;
      const mismo = ref.codigo ? ln.codigo === ref.codigo : ln.nombre === ref.nombre;
      return mismo ? acc + (parseInt(ln.cantidad, 10) || 0) : acc;
    }, 0);
  }

  // === OPTIMIZACIÓN: EVENT DELEGATION PARA INPUTS ===
  itemsBody.addEventListener('input', function(e) {
    const row = e.target.closest('tr');
    if (!row) return;

    const idx = parseInt(row.getAttribute('data-idx'));
    if (idx < 0 || idx >= items.length) return;

    const target = e.target;
    let needsRecalculation = false;

    // Actualizar solo el campo específico que cambió
    if (target.classList.contains('codigo')) {
      items[idx].codigo = target.value;
    } else if (target.classList.contains('cantidad')) {
      // Sanitizar: permitir sólo dígitos
      target.value = (target.value + '').replace(/\D/g, '');
      if (target.value === '') target.value = '1';
      let newCantidad = Math.max(1, parseInt(target.value, 10) || 1);
      // Una devolucion o garantia no puede superar lo que el cliente compro en el
      // pedido original: el tope viaja en la propia linea (cupoMaximo). Devolucion
      // y garantia del mismo articulo son lineas separadas pero comparten cupo,
      // asi que se descuenta lo comprometido en las otras.
      const topeLinea = parseInt(items[idx].cupoMaximo, 10) || 0;
      if (topeLinea > 0) {
        const disponible = Math.max(1, topeLinea - unidadesCambioEnOtrasLineas(idx));
        if (newCantidad > disponible) newCantidad = disponible;
      }
      // Reflejar valor normalizado en el input
      if (String(newCantidad) !== target.value) target.value = String(newCantidad);
      if (items[idx].cantidad !== newCantidad) {
        items[idx].cantidad = newCantidad;
        needsRecalculation = true;

        // Actualizar valorG si hay artículo válido
        if (items[idx].nombre && articulosPorNombre[items[idx].nombre]) {
          items[idx].valorG = signoLinea(items[idx]) * (items[idx].valorU - items[idx].valorC) * items[idx].cantidad;
        }

        // Actualizar valor total de la fila
        row.querySelector('.valorTotal').textContent = textoTotalLinea(items[idx]);
        if (esLineaCambio(items[idx]) && typeof refrescarCuposCambio === 'function') refrescarCuposCambio();
      }
    } else if (target.classList.contains('valorU')) {
      // Sanitizar: permitir sólo dígitos (sin separadores ni símbolos)
      target.value = (target.value + '').replace(/\D/g, '');
      const newValorU = parseInt(target.value, 10) || 0;
      // Reflejar valor normalizado en el input (vacío si 0 para mantener UX)
      if (newValorU === 0) {
        // mantener '0' visible o vacío según preferencia; dejamos '0' para consistencia
        target.value = '0';
      } else if (String(newValorU) !== target.value) {
        target.value = String(newValorU);
      }

      if (items[idx].valorU !== newValorU) {
        items[idx].valorU = newValorU;
        needsRecalculation = true;

        // Actualizar valorG si hay artículo válido
        if (items[idx].nombre && articulosPorNombre[items[idx].nombre]) {
          items[idx].valorG = signoLinea(items[idx]) * (items[idx].valorU - items[idx].valorC) * items[idx].cantidad;
        }

        // Actualizar valor total de la fila
        row.querySelector('.valorTotal').textContent = textoTotalLinea(items[idx]);
      }
    }

    // Solo recalcular si realmente cambió algo importante
    if (needsRecalculation) {
      debouncedCalculations();
    }
  });

  [recargoInput, descuentoInput, envioInput].forEach(input => {
    input.addEventListener('input', function() {
      // Normalizar y formatear
      let val = this.value.replace(/\D/g, '');
      // Formatear con punto como separador de miles
      this.value = val ? Number(val).toLocaleString('es-AR').replace(/,/g, '.') : '';
      calcularTotalFinal();
    });
  });

  // Nuevo: actualizar descuento automáticamente al cambiar el porcentaje
  if (typeof descuentoPorcentajeInput !== 'undefined' && descuentoPorcentajeInput) {
    descuentoPorcentajeInput.addEventListener('input', function() {
      calcularTotalFinal();
    });
  }

  // Si el usuario edita el campo descuento manualmente, limpiar el campo porcentaje
  if (typeof descuentoInput !== 'undefined' && descuentoInput) {
    descuentoInput.addEventListener('input', function() {
      if (typeof descuentoPorcentajeInput !== 'undefined' && descuentoPorcentajeInput && descuentoInput.value.trim() !== '') {
        descuentoPorcentajeInput.value = '';
      }
      calcularTotalFinal();
    });
  }

  // Nuevo: actualizar recargo automáticamente al cambiar el porcentaje
  if (typeof recargoPorcentajeInput !== 'undefined' && recargoPorcentajeInput) {
    recargoPorcentajeInput.addEventListener('input', function() {
      calcularTotalFinal();
    });
  }

  // Si el usuario edita el campo recargo manualmente, limpiar el campo porcentaje de recargo
  if (typeof recargoInput !== 'undefined' && recargoInput) {
    recargoInput.addEventListener('input', function() {
      if (typeof recargoPorcentajeInput !== 'undefined' && recargoPorcentajeInput && recargoInput.value.trim() !== '') {
        recargoPorcentajeInput.value = '';
      }
    });
  }

  form.addEventListener('reset', function() {
    // Limpiar recursos antes del reset
    cleanupAllHovers();
    
    // Destruir todos los Select2 antes de limpiar
    itemsBody.querySelectorAll('.nombre-select').forEach(select => {
      try {
        if ($(select).hasClass('select2-hidden-accessible')) {
          $(select).select2('destroy');
        }
      } catch (e) {
        // Silenciar errores de destrucción
      }
    });
    
    items = [];
    limpiarEstadoCambios();
    setTimeout(() => {
      renderItems();
      messageDiv.textContent = '';
      subtotalInput.value = '';
      totalFinalInput.value = '';
    }, 0);
  });

  // --- MODAL DE CONFIRMACIÓN PARA IMPRIMIR ---
  function mostrarModalImprimirOrden(onSi, onNo) {
    // Eliminar modal previo si existe
    const old = document.getElementById('modalImprimirOrden');
    if (old) old.remove();
    // Crear overlay
    const overlay = document.createElement('div');
    overlay.id = 'modalImprimirOrden';
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100vw';
    overlay.style.height = '100vh';
    overlay.style.background = 'rgba(0,0,0,0.35)';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.zIndex = '9999';
    // Modal box
    const box = document.createElement('div');
    box.style.background = '#fff';
    box.style.padding = '32px 24px 20px 24px';
    box.style.borderRadius = '10px';
    box.style.boxShadow = '0 2px 16px rgba(0,0,0,0.18)';
    box.style.textAlign = 'center';
    box.innerHTML = `
      <div style="font-size:1.2em;margin-bottom:18px;">¿Desea imprimir la Orden de pedido?</div>
      <button id="btnImprimirSi" style="background:#6c4eb6;color:#fff;padding:8px 24px;margin:0 12px;border:none;border-radius:4px;font-size:1em;">Sí</button>
      <button id="btnImprimirNo" style="background:#aaa;color:#fff;padding:8px 24px;margin:0 12px;border:none;border-radius:4px;font-size:1em;">No</button>
    `;
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    // Eventos
    function keyHandler(e) {
      if (overlay.style.display !== 'flex') return;
      if (e.key === 'Enter') {
        box.querySelector('#btnImprimirSi').click();
        e.preventDefault();
      } else if (e.key === 'Escape') {
        box.querySelector('#btnImprimirNo').click();
        e.preventDefault();
      }
    }
    document.addEventListener('keydown', keyHandler);
    function cleanup() {
      document.removeEventListener('keydown', keyHandler);
    }
    box.querySelector('#btnImprimirSi').onclick = () => {
      overlay.remove();
      cleanup();
      onSi();
    };
    box.querySelector('#btnImprimirNo').onclick = () => {
      overlay.remove();
      cleanup();
      onNo();
    };
  }

  // --- SUBMIT GLOBAL SOLO PARA ALTAS ---
  form.addEventListener('submit', function(e) {
    if (pedidoId) return; // Si es edición, no ejecutar alta
    e.preventDefault();
    // Un cambio mueve inventario en dos sentidos y puede anular importes: se confirma
    // el detalle antes de escribir en Firebase. Una venta normal entra directo, como siempre.
    if (items.some(esLineaCambio)) {
      mostrarModalConfirmarCambio(ingresarPedido);
    } else {
      ingresarPedido();
    }
  });

  // === MODAL DE CONFIRMACIÓN DE CAMBIO ===
  function mostrarModalConfirmarCambio(onConfirmar) {
    const overlay = document.getElementById('confirmarCambioOverlay');
    if (!overlay) { onConfirmar(); return; }

    const contMovs = document.getElementById('confirmarCambioMovs');
    contMovs.innerHTML = '';

    // Mismo criterio que guardarPedidoConMovimientos: DEVOLUCION entra, el resto sale.
    items.forEach(it => {
      if (!it.nombre || !it.cantidad) return;
      const entra = it.tipoLinea === 'DEVOLUCION';
      const fila = document.createElement('div');
      fila.className = 'confirmar-cambio-mov ' + (entra ? 'entrada' : 'salida');
      fila.innerHTML = `
        <span class="confirmar-cambio-mov-tag">${entra ? '↑ Entra a stock' : '↓ Sale de stock'}</span>
        <span class="confirmar-cambio-mov-detalle">${it.cantidad} × ${it.nombre}${it.tipoLinea === 'GARANTIA' ? ' <em>(garantía)</em>' : ''}</span>
      `;
      contMovs.appendChild(fila);
    });

    const origenes = [...new Set(items.filter(esLineaCambio).map(it => it.pedidoOrigenId).filter(Boolean))];
    document.getElementById('confirmarCambioOrigen').textContent =
      origenes.length ? origenes.map(idCortoPedido).join(', ') : '—';

    const diferencia = parseImporte(totalFinalInput.value);
    document.getElementById('confirmarCambioImporteLabel').textContent =
      diferencia > 0 ? 'A cobrar' : diferencia < 0 ? 'A devolver' : 'Importe';
    document.getElementById('confirmarCambioImporte').textContent =
      diferencia === 0 ? 'Sin cargo' : formatoPesos(Math.abs(diferencia));
    document.getElementById('confirmarCambioMedio').textContent = form.medioPago.value || '—';

    const btnOk = document.getElementById('confirmarCambioOkBtn');
    const btnCancel = document.getElementById('confirmarCambioCancelBtn');

    function cerrar() {
      overlay.style.display = 'none';
      document.removeEventListener('keydown', teclas);
      btnOk.onclick = null;
      btnCancel.onclick = null;
      overlay.onclick = null;
    }
    function teclas(ev) {
      if (ev.key === 'Escape') { ev.preventDefault(); cerrar(); }
      else if (ev.key === 'Enter') { ev.preventDefault(); btnOk.click(); }
    }

    btnOk.onclick = () => { cerrar(); onConfirmar(); };
    btnCancel.onclick = cerrar;
    overlay.onclick = ev => { if (ev.target === overlay) cerrar(); };
    document.addEventListener('keydown', teclas);

    overlay.style.display = 'flex';
    setTimeout(() => btnOk.focus(), 80);
  }

  // Extraer la lógica de ingreso de pedido a una función reutilizable
  function ingresarPedido() {
    if (enviandoPedido) return;
    enviandoPedido = true;

    // Validar campos obligatorios
    const nombre = form.nombre.value.trim();
    const direccion = form.direccion.value.trim();
    const medioPago = form.medioPago.value;
    const vendedor = form.vendedor ? form.vendedor.value.trim() : '';
    const tipoClienteRadio = document.querySelector('input[name="tipoCliente"]:checked');
    const tipoCliente = tipoClienteRadio ? tipoClienteRadio.value : '';

    if (!tipoCliente) {
      showPopup('Debe seleccionar el Tipo de Cliente.', '❗', false);
      enviandoPedido = false; return;
    }
    if (!medioPago) {
      showPopup('Debe seleccionar el Medio de Pago.', '❗', false);
      enviandoPedido = false; return;
    }
    if (!vendedor) {
      showPopup('Debe completar el campo Vendedor.', '❗', false);
      enviandoPedido = false; return;
    }

    const recargo = parseImporte(form.recargo.value);
    const descuento = parseImporte(form.descuento.value);
    const envio = parseImporte(form.envio.value);
    const subtotal = parseImporte(form.subtotal.value);
    const totalFinal = parseImporte(form.totalFinal.value);
    const nota = form.nota ? form.nota.value.trim() : '';
    const alias = form.alias ? form.alias.value.trim().toUpperCase() : '';

    if (items.length === 0) {
      showPopup('Debe agregar al menos un artículo.', '❗', false);
      enviandoPedido = false; return;
    }
    // Validar artículos
    for (const item of items) {
      if (!item.nombre || item.cantidad <= 0 || item.valorU < 0) {
        showPopup('Complete correctamente los datos de los artículos.', '❗', false);
        enviandoPedido = false; return;
      }

      // Una línea de cambio sin pedido de origen no se puede auditar ni valorizar
      if (esLineaCambio(item) && !item.pedidoOrigenId) {
        showPopup(`La línea de ${item.tipoLinea === 'GARANTIA' ? 'garantía' : 'devolución'} de "${item.nombre}" no tiene un pedido de origen asociado.`, '❗', false);
        enviandoPedido = false; return;
      }

      // FORZAR ACTUALIZACIÓN de todos los campos desde Google Sheets antes de guardar
      if (item.nombre && articulosPorNombre[item.nombre]) {
        const art = articulosPorNombre[item.nombre];
        // Forzar actualización de codigo, codigoBarras, categoria y seleccionado
        item.codigo = art[2] || '';
        item.codigoBarras = art[11] || '';
        item.categoria = art[0] || '';
        item.seleccionado = art[9] || '';
        // Forzar actualización de valorC, salvo en líneas de cambio: ahí el costo es el
        // que tenía el artículo cuando se vendió, y viene congelado del pedido original.
        if (!esLineaCambio(item)) {
          let valorCRaw = art[7] || '0';
          valorCRaw = valorCRaw.replace(/\$/g, '').replace(/[.,]/g, '');
          item.valorC = parseInt(valorCRaw) || 0;
        }
      } else {
        // Si no hay artículo válido, limpiar campos
        item.codigo = '';
        item.codigoBarras = '';
        item.categoria = '';
        item.seleccionado = '';
        if (!esLineaCambio(item)) item.valorC = 0;
      }

      // Asegurar que valorC nunca sea undefined (fallback adicional)
      if (typeof item.valorC === 'undefined' || item.valorC === null) {
        item.valorC = 0;
      }

      // Calcular valorG (el signo lo aporta el tipo de línea)
      item.valorG = signoLinea(item) * (item.valorU - item.valorC) * (item.cantidad || 1);
    }
    // Obtener cotización blue en tiempo real
    fetch('https://api.bluelytics.com.ar/v2/latest')
      .then(r => r.json())
      .then(d => {
        if (!d.blue || (typeof d.blue.value_sell === 'undefined' && typeof d.blue.sell === 'undefined')) {
          throw new Error('cotizacion');
        }
        let cotizacionCierre = (d.blue.value_sell || d.blue.sell);
        // Construir objeto pedido
        const costos = calcularCostos();
        const entrega = 'Local';

        // Obtener fecha de creación solo al crear el pedido
        function getFechaActual() {
          const now = new Date();
          const pad = n => n.toString().padStart(2, '0');
          return `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
        }

        // Calcular gananciaSelec: suma de valorG de los artículos seleccionados
        const gananciaSelec = items
          .filter(it => it.seleccionado && it.seleccionado.toUpperCase() === 'SI')
          .reduce((acc, it) => acc + (parseInt(it.valorG) || 0), 0);
        const pedidoObj = {
          timestamp: Date.now(),
          locked: true,
          adminViewed: true,
          cliente: { nombre, direccion, tipoCliente },
          items: items.map(it => ({
            codigo: it.codigo, codigoBarras: it.codigoBarras, nombre: it.nombre,
            cantidad: it.cantidad, valorU: it.valorU, valorC: it.valorC,
            categoria: it.categoria, seleccionado: it.seleccionado, valorG: it.valorG,
            // Los campos de cambio solo se escriben en las líneas que los tienen: así los
            // pedidos de venta normales quedan idénticos a los de siempre.
            ...(esLineaCambio(it) ? {
              tipoLinea: it.tipoLinea,
              pedidoOrigenId: it.pedidoOrigenId || '',
              motivo: it.motivo || '',
              ...(it.valorULista ? { valorULista: it.valorULista } : {})
            } : {})
          })),
          pagos: {
            medioPago,
            recargo,
            descuento,
            envio,
            subtotal,
            totalFinal,
            costos,
            ganancia: subtotal - costos - descuento,
            gananciaSelec,
            // Solo incluir alias si tiene valor (Transferencia/Parcial);
            // omitirlo elimina el campo de Firebase con otros medios de pago.
            ...(alias ? { alias } : {})
          },
          status: 'DESPACHADO/ENTREGADO',
          cotizacionCierre: cotizacionCierre,
          costoUSD: costos / cotizacionCierre,
          createdby: 'admin',
          entrega,
          nota,
          vendedor,
          ...datosOperacionCambio()
        };
        // Guardar en Firebase
        if (pedidoId) {
          db.ref('pedidos/' + pedidoId).once('value').then(async snap => {
            const pedidoAnterior = snap.val();
            // CONSERVAR lastOrderUpdate si existe
            if (pedidoAnterior && pedidoAnterior.lastOrderUpdate) {
              pedidoObj.lastOrderUpdate = pedidoAnterior.lastOrderUpdate;
            }
            // CONSERVAR fecha original si existe
            if (pedidoAnterior && pedidoAnterior.fecha) {
              pedidoObj.fecha = pedidoAnterior.fecha;
            }
            
            // BLOQUEAR INTERFAZ durante proceso crítico
            bloquearInterfaz('Actualizando pedido y restaurando inventario...');
            
            try {
              // Guardado atómico: pedido + movimientos en una sola operación (todo o nada)
              await guardarPedidoConMovimientos(pedidoId, pedidoObj, items);

              // DESBLOQUEAR INTERFAZ después de completar proceso
              desbloquearInterfaz();
              enviandoPedido = false;

              messageDiv.textContent = 'Pedido actualizado correctamente.';
              messageDiv.style.color = 'green';
              setTimeout(() => {
                if (window.opener && !window.opener.closed) {
                  window.opener.location.reload();
                  window.close();
                } else {
                  window.location.href = 'ingresoPedidoV2.html';
                }
              }, 1200);
            } catch (err) {
              // DESBLOQUEAR INTERFAZ en caso de error
              desbloquearInterfaz();
              enviandoPedido = false;
              console.error('Error al actualizar pedido:', err);
              messageDiv.textContent = 'Error al actualizar el pedido.';
              messageDiv.style.color = 'red';
            }
          });
        } else {

          // Agregar campo fecha solo al crear el pedido
          pedidoObj.fecha = getFechaActual();
          
          // BLOQUEAR INTERFAZ durante proceso crítico
          bloquearInterfaz('Registrando pedido y actualizando inventario...');
          
          // Usar push para obtener el id generado (sin escribir todavía)
          const pedidoRef = db.ref('pedidos').push();
          // Guardado atómico: pedido + movimientos en una sola operación (todo o nada)
          guardarPedidoConMovimientos(pedidoRef.key, pedidoObj, items)
            .then(async () => {
              // Guardar alias en localStorage si se usó uno
              if (pedidoObj.pagos && pedidoObj.pagos.alias && pedidoObj.pagos.alias.trim() !== '') {
                guardarAliasEnLocalStorage(pedidoObj.pagos.alias.trim().toUpperCase());
              }
              // DESBLOQUEAR INTERFAZ después de completar proceso
              desbloquearInterfaz();
              enviandoPedido = false;

              // Mostrar modal de impresión DESPUÉS de guardar exitosamente
              mostrarModalImprimirOrden(
                function() { // Sí imprimir
                  generarReciboYImprimir(pedidoRef.key);
                  showPopup('Pedido ingresado', '✅', true);
                  if (window.desactivarModoAdmin) window.desactivarModoAdmin();
                  if (window.contraerExtraCliente) window.contraerExtraCliente();
                  form.reset();
                  items = [];
                  limpiarEstadoCambios();
                  renderItems();
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                },
                function() { // No imprimir
                  showPopup('Pedido ingresado', '✅', true);
                  if (window.desactivarModoAdmin) window.desactivarModoAdmin();
                  if (window.contraerExtraCliente) window.contraerExtraCliente();
                  form.reset();
                  items = [];
                  limpiarEstadoCambios();
                  renderItems();
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }
              );
            })
            .catch(err => {
              // DESBLOQUEAR INTERFAZ en caso de error
              desbloquearInterfaz();
              enviandoPedido = false;
              showPopup('Error al guardar el pedido.', '❌', false);
            });
        }
      })
      .catch(err => {
        enviandoPedido = false;
        if (err && err.message === 'cotizacion') {
          showPopup('No se pudo obtener la cotización del dólar blue.', '❌', false);
        } else {
          showPopup('Ocurrió un error inesperado al guardar el pedido.', '❌', false);
        }
      });
  }

  // --- POPUP MODAL ---
  function showPopup(message, emoji, autoClose, imageUrl = null) {
    // Remove existing popup if any
    const old = document.getElementById('popupPedidoMsg');
    if (old) old.remove();
    const overlay = document.createElement('div');
    overlay.id = 'popupPedidoMsg';
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100vw';
    overlay.style.height = '100vh';
    overlay.style.background = 'rgba(0,0,0,0.35)';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.zIndex = '99999';
    
    // Crear imagen si se proporciona URL
    const imageHtml = imageUrl ? `
      <div style="margin-bottom: 16px;">
     <img src="${imageUrl}" 
       style="width: 250px; height: 250px; object-fit: cover; border-radius: 8px; border: 2px solid #e0e0e0;" 
       alt="Imagen del artículo"
       onerror="this.style.display='none'">
      </div>
    ` : '';
    
    overlay.innerHTML = `
      <div style="background:#fff;padding:32px 24px;border-radius:16px;box-shadow:0 4px 32px #0002;min-width:320px;max-width:90vw;display:flex;flex-direction:column;align-items:center;">
        ${imageHtml}
        <div style="font-size:3rem;">${emoji}</div>
        <div style="font-size:1.3rem;margin:18px 0 10px 0;text-align:center;">${message}</div>
        <button id="popupPedidoOk" style="margin-top:10px;background:#6c4eb6;color:#fff;padding:8px 32px;border:none;border-radius:6px;font-size:1.1rem;cursor:pointer;">Ok</button>
      </div>
    `;
    document.body.appendChild(overlay);
    // Close on Ok
    overlay.querySelector('#popupPedidoOk').onclick = function() {
      overlay.remove();
    };
    // Close on click outside
    overlay.onclick = function(e) {
      if (e.target === overlay) overlay.remove();
    };
    // Optional auto close
    if (autoClose) {
      setTimeout(() => {
        if (overlay.parentNode) overlay.remove();
      }, 5000);
    }
    // Soporte Enter/Escape
    function keyHandler(e) {
      if (overlay.style.display !== 'flex') return;
      if (e.key === 'Enter' || e.key === 'Escape') {
        overlay.remove();
        cleanup();
        e.preventDefault();
      }
    }
    function cleanup() {
      document.removeEventListener('keydown', keyHandler);
    }
    document.addEventListener('keydown', keyHandler);
  }

  // === AVISO DE DEVOLUCIONES SOBRE EL PEDIDO QUE SE ESTÁ EDITANDO ===
  // Los pedidos de cambio dejan una retro-referencia en pedidos/{id}/devoluciones
  // (ver guardarPedidoConMovimientos). Sin este aviso, quien reabre el pedido original
  // no tiene forma de saber que parte de esa mercadería ya volvió al depósito, y podría
  // recalcularlo o reimprimirlo como si siguiera intacto.
  function renderAvisoDevoluciones(devoluciones) {
    const previo = document.getElementById('avisoDevoluciones');
    if (previo) previo.remove();
    if (!devoluciones || typeof devoluciones !== 'object') return;

    const entradas = Object.keys(devoluciones)
      .map(id => ({ id, ...(devoluciones[id] || {}) }))
      .filter(e => Array.isArray(e.lineas) && e.lineas.length > 0);
    if (entradas.length === 0) return;

    let unidades = 0;
    let hayGarantia = false;
    const filas = entradas.map(e => {
      const detalle = e.lineas.map(l => {
        const cant = parseInt(l && l.cantidad, 10) || 0;
        unidades += cant;
        const esGarantia = l && l.tipoLinea === 'GARANTIA';
        if (esGarantia) hayGarantia = true;
        const nombre = (l && (l.nombre || l.codigo)) || 'artículo';
        return `<span class="aviso-dev-linea">${cant} × ${nombre}` +
               `<em class="aviso-dev-tipo">${esGarantia ? '⚠ garantía' : '↩ devolución'}</em></span>`;
      }).join('');
      return `<li>${detalle}
                <span class="aviso-dev-ref">${e.fecha || 'sin fecha'} · pedido
                  <a href="ingresoPedidoV2.html?id=${encodeURIComponent(e.id)}" title="${e.id}">${idCortoPedido(e.id)}</a>
                </span>
              </li>`;
    }).join('');

    const titulo = hayGarantia
      ? `Este pedido tiene ${unidades} ${unidades === 1 ? 'unidad procesada' : 'unidades procesadas'} en cambios o garantías`
      : `Este pedido tiene ${unidades} ${unidades === 1 ? 'unidad devuelta' : 'unidades devueltas'}`;

    const aviso = document.createElement('div');
    aviso.id = 'avisoDevoluciones';
    aviso.className = 'aviso-devoluciones';
    aviso.innerHTML =
      '<div class="aviso-dev-titulo"><span aria-hidden="true">↩</span> ' + titulo + '</div>' +
      '<ul class="aviso-dev-lista">' + filas + '</ul>' +
      '<div class="aviso-dev-nota">Los importes de este pedido no reflejan esa reversión: quedó registrada en el pedido de cambio.</div>';
    form.parentNode.insertBefore(aviso, form);
  }

  // === SOPORTE EDICIÓN DE PEDIDOS ===
  // Si hay un parámetro id en la URL, cargar el pedido y rellenar el formulario para editar
  const urlParams = new URLSearchParams(window.location.search);
  const pedidoId = urlParams.get('id');
  if (pedidoId) {
    db.ref('pedidos/' + pedidoId).once('value').then(snap => {
      const pedido = snap.val();
      if (!pedido) return;
      // Expandir campos extra al cargar un pedido existente
      if (window.expandirExtraCliente) window.expandirExtraCliente();
      // Rellenar datos del cliente
      form.nombre.value = pedido.cliente?.nombre || '';
      form.telefono.value = pedido.cliente?.telefono || '';
      form.direccion.value = pedido.cliente?.direccion || '';
      form.dni.value = pedido.cliente?.dni || '';
      form.email.value = pedido.cliente?.email || '';
      // Rellenar tipo de cliente si existe
      if (pedido.cliente?.tipoCliente) {
        const radio = document.querySelector(`input[name="tipoCliente"][value="${pedido.cliente.tipoCliente}"]`);
        if (radio) {
          radio.checked = true;
          tipoCliente = pedido.cliente.tipoCliente; // <-- ACTUALIZAR VARIABLE INTERNA
          // Forzar actualización de valores de artículos según tipoCliente
          // (las líneas de cambio conservan el importe histórico del pedido original)
          items.forEach((item, idx) => {
            if (item.nombre && articulosPorNombre[item.nombre] && !esLineaCambio(item)) {
              const art = articulosPorNombre[item.nombre];
              let valorRaw = tipoCliente === 'consumidor final' ? (art[4] || '0') : (art[6] || '0');
              valorRaw = valorRaw.replace(/\$/g, '').replace(/[.,]/g, '');
              items[idx].valorU = parseInt(valorRaw) || 0;
            }
          });
        }
      }
      // Rellenar items
      items = (pedido.items || []).map(it => ({
        codigo: it.codigo || '',
        codigoBarras: it.codigoBarras || '',
        nombre: it.nombre || '',
        cantidad: it.cantidad || 1,
        valorU: it.valorU || 0,
        valorC: typeof it.valorC !== 'undefined' ? it.valorC : 0,
        categoria: typeof it.categoria !== 'undefined' ? it.categoria : '',
        seleccionado: typeof it.seleccionado !== 'undefined' ? it.seleccionado : (it.nombre && articulosPorNombre[it.nombre] ? articulosPorNombre[it.nombre][8] || '' : ''),
        valorG: typeof it.valorG !== 'undefined' ? it.valorG : (typeof it.valorU !== 'undefined' && typeof it.valorC !== 'undefined' ? it.valorU - it.valorC : 0),
        // Los pedidos anteriores a los cambios no traen tipoLinea: se leen como VENTA
        tipoLinea: it.tipoLinea || 'VENTA',
        pedidoOrigenId: it.pedidoOrigenId || '',
        motivo: it.motivo || '',
        valorULista: it.valorULista || 0
      }));
      renderItems();
      // Rellenar pagos
      form.medioPago.value = pedido.pagos?.medioPago || '';
      form.recargo.value = pedido.pagos?.recargo ? Number(String(pedido.pagos.recargo).replace(/\D/g, '')).toLocaleString('es-AR').replace(/,/g, '.') : '';
      form.descuento.value = pedido.pagos?.descuento ? Number(String(pedido.pagos.descuento).replace(/\D/g, '')).toLocaleString('es-AR').replace(/,/g, '.') : '';
      form.envio.value = pedido.pagos?.envio ? Number(String(pedido.pagos.envio).replace(/\D/g, '')).toLocaleString('es-AR').replace(/,/g, '.') : '';
      // Mostrar subtotal y total como enteros con separador de miles (conservando el signo:
      // un cambio con saldo a favor del cliente se guarda con importe negativo)
      form.subtotal.value = pedido.pagos?.subtotal ? parseImporte(pedido.pagos.subtotal).toLocaleString('es-AR').replace(/,/g, '.') : '';
      form.totalFinal.value = pedido.pagos?.totalFinal ? parseImporte(pedido.pagos.totalFinal).toLocaleString('es-AR').replace(/,/g, '.') : '';
      // Autocompletar nota y vendedor si existen
      if (form.nota) form.nota.value = pedido.nota || '';
      // El vendedor del pedido puede no estar en la planilla (alguien que ya no trabaja):
      // se repone como opción para que el desplegable no quede vacío al editar.
      if (form.vendedor) {
        asegurarOpcionVendedor(pedido.vendedor);
        form.vendedor.value = pedido.vendedor || '';
      }
      if (form.alias) form.alias.value = pedido.pagos?.alias || '';

      // --- SOLO LECTURA SI STATUS ES CANCELADO ---
      if (pedido.status === 'CANCELADO') {
        // Eliminar movimientos de inventario asociados a este pedido cancelado
        if (pedidoId) {
          db.ref('movimientos').orderByChild('pedidoId').equalTo(pedidoId).once('value', function(snapshot) {
            const updates = {};
            snapshot.forEach(child => {
              updates[child.key] = null;
            });
            if (Object.keys(updates).length > 0) {
              db.ref('movimientos').update(updates).catch(err => {
                console.error('Error eliminando movimientos por cancelación:', err, updates);
              });
            }
          });

          // Si era un cambio, soltar las retro-referencias que dejó en los pedidos de
          // origen: de lo contrario esas unidades seguirían figurando como devueltas.
          const origenesCancelados = [...new Set((pedido.items || [])
            .map(it => it && it.pedidoOrigenId).filter(Boolean))];
          if (origenesCancelados.length > 0) {
            const limpieza = {};
            origenesCancelados.forEach(origenId => {
              limpieza[`pedidos/${origenId}/devoluciones/${pedidoId}`] = null;
            });
            db.ref().update(limpieza).catch(err => {
              console.error('Error limpiando devoluciones por cancelación:', err, limpieza);
            });
          }
        }
        // Deshabilitar todos los campos del formulario
        Array.from(form.elements).forEach(el => {
          el.disabled = true;
        });
        // Deshabilitar selects y radios fuera del form (por si acaso)
        document.querySelectorAll('input[type="radio"], select').forEach(el => {
          el.disabled = true;
        });
        // Deshabilitar botones de acción
        document.querySelectorAll('button, input[type="button"]').forEach(btn => {
          btn.disabled = true;
        });
        // Mostrar mensaje de solo lectura
        let lockedMsg = document.getElementById('lockedMsg');
        if (!lockedMsg) {
          lockedMsg = document.createElement('div');
          lockedMsg.id = 'lockedMsg';
          lockedMsg.textContent = 'Este pedido está cancelado y no puede modificarse.';
          lockedMsg.style = 'background:#ffe0e0;color:#b00;padding:10px 18px;margin-bottom:12px;border-radius:6px;font-weight:bold;text-align:center;';
          form.parentNode.insertBefore(lockedMsg, form);
        }
      }

      // Aviso de devoluciones/garantías que otros pedidos registraron contra éste.
      renderAvisoDevoluciones(pedido.devoluciones);
    });
    // Cambiar el texto del botón submit a "Modificar"
    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.textContent = 'Modificar';
    // Cambiar el submit para actualizar en vez de crear
    form.onsubmit = function(e) {
      e.preventDefault();
      if (enviandoPedido) return;
      mostrarModalPasswordEdicion(function(contrasena) {
        if (!contrasena) return; // Si se cancela, no continuar
        enviandoPedido = true;
        modificarPedido(contrasena);
      });
    };

    // Nueva función para modificar el pedido (solo si la contraseña fue correcta y no se canceló nada)
    function modificarPedido(contrasena) {
      // Validar artículos
      for (const item of items) {
        if (!item.nombre || item.cantidad <= 0 || item.valorU < 0) {
          messageDiv.textContent = 'Complete correctamente los datos de los artículos.';
          messageDiv.style.color = 'red';
          enviandoPedido = false; return;
        }
        
        // FORZAR ACTUALIZACIÓN de todos los campos desde Google Sheets antes de guardar
        if (item.nombre && articulosPorNombre[item.nombre]) {
          const art = articulosPorNombre[item.nombre];
          // Forzar actualización de codigo, codigoBarras, categoria y seleccionado
          item.codigo = art[2] || '';
          item.codigoBarras = art[11] || '';
          item.categoria = art[0] || '';
          item.seleccionado = art[9] || '';
          // Forzar actualización de valorC (nunca en líneas de cambio: llevan el costo
          // histórico del pedido original)
          if (!esLineaCambio(item)) {
            let valorCRaw = art[7] || '0';
            valorCRaw = valorCRaw.replace(/\$/g, '').replace(/[.,]/g, '');
            item.valorC = parseInt(valorCRaw) || 0;
          }
        } else {
          // Si no hay artículo válido, limpiar campos
          item.codigo = '';
          item.codigoBarras = '';
          item.categoria = '';
          item.seleccionado = '';
          if (!esLineaCambio(item)) item.valorC = 0;
        }

        // Asegurar que valorC nunca sea undefined (fallback adicional)
        if (typeof item.valorC === 'undefined' || item.valorC === null) {
          item.valorC = 0;
        }

        // Calcular valorG (el signo lo aporta el tipo de línea)
        item.valorG = signoLinea(item) * (item.valorU - item.valorC) * (item.cantidad || 1);
      }
      const subtotal = parseImporte(form.subtotal.value);
      const totalFinal = parseImporte(form.totalFinal.value);
      const recargo = parseImporte(form.recargo.value);
      const descuento = parseImporte(form.descuento.value);
      const envio = parseImporte(form.envio.value);
      const nota = form.nota ? form.nota.value.trim() : '';
      const vendedor = form.vendedor ? form.vendedor.value.trim() : '';
      const alias = form.alias ? form.alias.value.trim().toUpperCase() : '';
      
      
      // Obtener cotización blue en tiempo real
      fetch('https://api.bluelytics.com.ar/v2/latest')
        .then(r => r.json())
        .then(d => {
          let cotizacionCierre = (d.blue.value_sell || d.blue.sell);
          const costos = calcularCostos();
          const entrega = 'Local';
          // Calcular gananciaSelec: suma de valorG de los artículos seleccionados
          const gananciaSelec = items
            .filter(it => it.seleccionado && it.seleccionado.toUpperCase() === 'SI')
            .reduce((acc, it) => acc + (parseInt(it.valorG) || 0), 0);
          const pedidoObj = {
            timestamp: Date.now(),
            locked: true,
            adminViewed: true,
            cliente: { nombre: form.nombre.value.trim(), direccion: form.direccion.value.trim(), tipoCliente: document.querySelector('input[name="tipoCliente"]:checked')?.value || '' },
            items: items.map(it => ({
              codigo: it.codigo, codigoBarras: it.codigoBarras, nombre: it.nombre,
              cantidad: it.cantidad, valorU: it.valorU, valorC: it.valorC,
              categoria: it.categoria, seleccionado: it.seleccionado, valorG: it.valorG,
              ...(esLineaCambio(it) ? {
                tipoLinea: it.tipoLinea,
                pedidoOrigenId: it.pedidoOrigenId || '',
                motivo: it.motivo || '',
                ...(it.valorULista ? { valorULista: it.valorULista } : {})
              } : {})
            })),
            pagos: {
              medioPago: form.medioPago.value,
              recargo,
              descuento,
              envio,
              subtotal,
              totalFinal,
              costos,
              ganancia: subtotal - costos - descuento,
              gananciaSelec,
              // Solo incluir alias si tiene valor (Transferencia/Parcial);
              // omitirlo elimina el campo de Firebase con otros medios de pago.
              ...(alias ? { alias } : {})
            },
            status: 'DESPACHADO/ENTREGADO',
            cotizacionCierre: cotizacionCierre,
            costoUSD: costos / cotizacionCierre,
            createdby: 'admin',
            entrega,
            nota,
            vendedor,
            lastOrderUpdate: contrasena,
            ...datosOperacionCambio()
          };
          // CONSERVAR fecha original si existe
          db.ref('pedidos/' + pedidoId).once('value').then(snap => {
            const pedido = snap.val();
            if (pedido && pedido.fecha) {
              pedidoObj.fecha = pedido.fecha;
            }
            
            // BLOQUEAR INTERFAZ durante proceso crítico
            bloquearInterfaz('Guardando cambios y actualizando inventario...');
            
            // Guardado atómico: pedido + movimientos en una sola operación (todo o nada)
            guardarPedidoConMovimientos(pedidoId, pedidoObj, items)
              .then(async () => {
                // Guardar alias en localStorage si se usó uno
                if (pedidoObj.pagos && pedidoObj.pagos.alias && pedidoObj.pagos.alias.trim() !== '') {
                  guardarAliasEnLocalStorage(pedidoObj.pagos.alias.trim().toUpperCase());
                }
                
                // DESBLOQUEAR INTERFAZ después de completar proceso
                desbloquearInterfaz();
                enviandoPedido = false;

                // Mostrar modal de impresión DESPUÉS de actualizar exitosamente
                mostrarModalImprimirOrden(
                  function() { // Sí imprimir
                    generarReciboYImprimir(pedidoId);
                    messageDiv.textContent = 'Pedido actualizado correctamente.';
                    messageDiv.style.color = 'green';
                    setTimeout(() => {
                      if (window.opener && !window.opener.closed) {
                        window.opener.location.reload();
                        window.close();
                      } else {
                        window.location.href = 'ingresoPedidoV2.html';
                      }
                    }, 1200);
                  },
                  function() { // No imprimir
                    messageDiv.textContent = 'Pedido actualizado correctamente.';
                    messageDiv.style.color = 'green';
                    setTimeout(() => {
                      if (window.opener && !window.opener.closed) {
                        window.opener.location.reload();
                        window.close();
                      } else {
                        window.location.href = 'ingresoPedidoV2.html';
                      }
                    }, 1200);
                  }
                );
              })
              .catch(err => {
                // DESBLOQUEAR INTERFAZ en caso de error
                desbloquearInterfaz();
                enviandoPedido = false;
                messageDiv.textContent = 'Error al actualizar el pedido.';
                messageDiv.style.color = 'red';
              });
          });
        })
        .catch(() => {
          enviandoPedido = false;
          messageDiv.textContent = 'No se pudo obtener la cotización del dólar blue.';
          messageDiv.style.color = 'red';
        });
    }
  }

  // Hacer campos de cliente solo lectura (excepto nombre)
  form.telefono.readOnly = true;
  form.direccion.readOnly = true;
  form.dni.readOnly = true;
  form.email.readOnly = true;

  // Botón Registrar Cliente: única vía de alta en el nodo "clientes".
  // El pedido nunca da de alta al cliente por su cuenta (clientes de paso).
  const registrarClienteBtn = document.getElementById('registrarClienteBtn');
  if (registrarClienteBtn) {
    registrarClienteBtn.onclick = function() {
      const nombre = form.nombre.value.trim();
      if (!nombre || nombre.toLowerCase() === 'n/a') {
        showPopup('Ingrese el nombre del cliente antes de registrarlo.', '❗', false);
        form.nombre.focus();
        return;
      }
      mostrarModalRegistroCliente(
        nombre,
        form.telefono.value.trim(),
        form.direccion.value.trim(),
        form.dni.value.trim(),
        form.email.value.trim(),
        'mayorista',
        false
      );
      const modal = document.getElementById('modalRegistroCliente');
      if (modal) modal.style.display = 'flex';
    };
    registrarClienteBtn.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        registrarClienteBtn.click();
      }
    });
  }

  // Botón Editar Cliente
  const editarClienteBtn = document.getElementById('editarClienteBtn');
  if (editarClienteBtn) {
    editarClienteBtn.onclick = function() {
      // Obtener datos actuales del formulario
      const nombre = form.nombre.value.trim();
      const telefono = form.telefono.value.trim();
      const direccion = form.direccion.value.trim();
      const dni = form.dni.value.trim();
      const email = form.email.value.trim();
      let tipoCliente = 'consumidor final';
      const tipoRadio = document.querySelector('input[name="tipoCliente"]:checked');
      if (tipoRadio) tipoCliente = tipoRadio.value;
      mostrarModalRegistroCliente(nombre, telefono, direccion, dni, email, tipoCliente, true);
      // Forzar display flex para asegurar que el modal esté visible
      const modal = document.getElementById('modalRegistroCliente');
      if (modal) modal.style.display = 'flex';
    };
    // Soporte teclado: Enter abre modal, Escape cierra modal si está abierto o blurea el botón
    editarClienteBtn.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        editarClienteBtn.click();
      } else if (e.key === 'Escape') {
        // Si el modal está abierto, ciérralo
        const modal = document.getElementById('modalRegistroCliente');
        if (modal && (modal.style.display === 'flex' || modal.style.display === '')) {
          const cancelarBtn = modal.querySelector('#cancelarNuevoCliente');
          if (cancelarBtn) cancelarBtn.click();
        } else {
          // Si no hay modal, blurea el botón
          editarClienteBtn.blur();
        }
      }
    });
  }

  /* FUNCIÓN PARA ACTUALIZAR RECARGO AUTOMÁTICO SEGÚN MEDIO DE PAGO DESACTIVADA

  // Detectar cambio de medio de pago y aplicar recargo automático si corresponde
  function actualizarRecargoAutomatico() {
    if (form.medioPago.value === 'MercadoPago') {
      let subtotal = items.reduce((acc, it) => acc + (it.cantidad * it.valorU), 0);
      let recargo = Math.round(subtotal * 0.06);
      recargoInput.value = recargo.toLocaleString('es-AR', {maximumFractionDigits:0});
      // recargoInput.readOnly = true; // Ahora siempre editable
    } else if (form.medioPago.value === 'Transferencia') {
      let subtotal = items.reduce((acc, it) => acc + (it.cantidad * it.valorU), 0);
      let recargo = Math.round(subtotal * 0.04);
      recargoInput.value = recargo.toLocaleString('es-AR', {maximumFractionDigits:0});
      // recargoInput.readOnly = true; // Ahora siempre editable
    } else {
      // recargoInput.readOnly = false; // Siempre editable
      recargoInput.value = '';
    }
  }

  /* form.medioPago.addEventListener('change', function() {
    actualizarRecargoAutomatico();
    calcularTotalFinal();
  });

  // Actualizar recargo automáticamente si está MercadoPago o Transferencia y cambia el subtotal
  function recalcularYActualizarRecargoSiMedioPago() {
    const medioPago = form.medioPago.value;
    if (medioPago === 'MercadoPago' || medioPago === 'Transferencia') {
      actualizarRecargoAutomatico();
      calcularTotalFinal();
    }
  }

  // === OPTIMIZACIÓN: DEBOUNCE PARA RECARGO ===
  let recargoTimeout;
  function debouncedRecargoUpdate() {
    clearTimeout(recargoTimeout);
    recargoTimeout = setTimeout(recalcularYActualizarRecargoSiMedioPago, 100);
  }
    
  */

  // Autocompletar recargo 6% al seleccionar Crédito
  form.medioPago.addEventListener('change', function() {
    if (this.value === 'Credito') {
      recargoPorcentajeInput.value = '6';
    } else {
      recargoPorcentajeInput.value = '';
      recargoInput.value = '';
    }
    calcularTotalFinal();
  });

  // Llamar a la función después de cada cambio relevante solo si es necesario
  // Al modificar descuentos/envío (mantener directo)
  [recargoInput, descuentoInput, envioInput].forEach(input => {
    input.addEventListener('input', function() {
      // Normalizar y formatear
      let val = this.value.replace(/\D/g, '');
      // Formatear con punto como separador de miles
      this.value = val ? Number(val).toLocaleString('es-AR').replace(/,/g, '.') : '';
      calcularTotalFinal();
    });
  });

  // === Calcular Costos ===
  let costosCache = null;
  let lastItemsHash = '';
  
  function calcularCostos() {
    // Crear hash simple de los items para detectar cambios.
    // Incluye tipoLinea y valorC: un mismo artículo con la misma cantidad tiene costo
    // opuesto según sea venta o devolución, y la caché debe distinguirlos.
    const currentHash = items.map(item => `${item.nombre}-${item.cantidad}-${item.tipoLinea || 'VENTA'}-${item.valorC || 0}`).join('|');

    if (costosCache !== null && lastItemsHash === currentHash) {
      return costosCache;
    }

    let costos = 0;
    items.forEach(item => {
      if (item.nombre && articulosPorNombre[item.nombre]) {
        // Usar valorC que ya está calculado en el item. El signo lo aporta el tipo de línea:
        // una devolución recupera el costo, una garantía no computa costo alguno.
        costos += costoLinea(item);
      }
    });

    costosCache = costos;
    lastItemsHash = currentHash;
    return costos;
  }

  // === CLIENTES: Autocompletar y registro ===
let clientesRegistrados = [];
let clientesPorNombre = {};

// Crear datalist para autocompletar nombre
let datalistClientes = document.getElementById('clientesDatalist');
if (!datalistClientes) {
  datalistClientes = document.createElement('datalist');
  datalistClientes.id = 'clientesDatalist';
  document.body.appendChild(datalistClientes);
}
form.nombre.setAttribute('list', 'clientesDatalist');

// Cargar clientes desde Firebase
let mostrarClientesAdmin = false;

function cargarClientes() {
  db.ref('clientes').once('value').then(snap => {
    clientesRegistrados = [];
    clientesPorNombre = {};
    datalistClientes.innerHTML = '';
    snap.forEach(child => {
      const cli = child.val();
      if (cli && cli.nombre && (mostrarClientesAdmin ? cli.tipoCliente === 'admin' : cli.tipoCliente !== 'admin')) {
        clientesRegistrados.push(cli);
        clientesPorNombre[cli.nombre.toLowerCase()] = cli;
      }
    });
    clientesRegistrados.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }));
    clientesRegistrados.forEach(cli => {
      const opt = document.createElement('option');
      opt.value = cli.nombre;
      datalistClientes.appendChild(opt);
    });
  });
}
// El botón "Cargar" dispara la carga de clientes desde Firebase
const cargarClienteBtn = document.getElementById('cargarClienteBtn');
if (cargarClienteBtn) {
  cargarClienteBtn.addEventListener('click', function() {
    cargarClienteBtn.disabled = true;
    cargarClienteBtn.textContent = 'Cargando...';
    if (form.nombre.value.trim() === 'n/a') form.nombre.value = '';
    db.ref('clientes').once('value').then(snap => {
      clientesRegistrados = [];
      clientesPorNombre = {};
      datalistClientes.innerHTML = '';
      snap.forEach(child => {
        const cli = child.val();
        if (cli && cli.nombre && (mostrarClientesAdmin ? cli.tipoCliente === 'admin' : cli.tipoCliente !== 'admin')) {
          clientesRegistrados.push(cli);
          clientesPorNombre[cli.nombre.toLowerCase()] = cli;
        }
      });
      clientesRegistrados.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }));
      clientesRegistrados.forEach(cli => {
        const opt = document.createElement('option');
        opt.value = cli.nombre;
        datalistClientes.appendChild(opt);
      });
      cargarClienteBtn.textContent = 'Cargado';
      cargarClienteBtn.disabled = true;
      cargarClienteBtn.style.background = '#6c757d';
    }).catch(() => {
      cargarClienteBtn.textContent = 'Cargar';
      cargarClienteBtn.disabled = false;
    });
  });
}

// === VENDEDORES: el desplegable se arma desde la planilla (Vendedores!A:A) ===
// Las <option> que trae el HTML son sólo el respaldo para cuando la planilla no
// responde: sin vendedor el pedido no se puede guardar, así que la caja nunca
// puede quedarse con el desplegable vacío.
const VENDEDORES_RANGO = 'Vendedores!A:A';

// Agrega el valor al desplegable si todavía no figura entre las opciones.
// Un pedido viejo puede tener un vendedor que ya no está en la planilla: sin la
// opción, asignar el value dejaría el select vacío y el pedido no se guardaría.
function asegurarOpcionVendedor(valor) {
  if (!form.vendedor || !valor) return;
  const existe = Array.from(form.vendedor.options)
    .some(o => o.value.toLowerCase() === valor.toLowerCase());
  if (existe) return;
  const opt = document.createElement('option');
  opt.value = valor;
  opt.textContent = valor;
  form.vendedor.appendChild(opt);
}

function cargarVendedoresDesdeSheets() {
  if (!form.vendedor || typeof GOOGLE_SHEETS_CONFIG === 'undefined') return;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEETS_CONFIG.SPREADSHEET_ID}/values/${encodeURIComponent(VENDEDORES_RANGO)}?key=${GOOGLE_SHEETS_CONFIG.API_KEY}`;
  fetch(url)
    .then(r => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)))
    .then(data => {
      const filas = data.values || [];
      const vistos = new Set();
      const nombres = [];
      filas.forEach((fila, i) => {
        const nombre = (fila && fila[0] ? String(fila[0]) : '').trim();
        if (!nombre) return;
        // El rango arranca en A1: si esa celda es el rótulo de la columna, no es un vendedor.
        if (i === 0 && ['vendedor', 'vendedores', 'nombre'].includes(nombre.toLowerCase())) return;
        const clave = nombre.toLowerCase();
        if (vistos.has(clave)) return;
        vistos.add(clave);
        nombres.push(nombre);
      });

      // Planilla vacía o ilegible: se conservan las opciones de respaldo del HTML.
      if (nombres.length === 0) return;

      const seleccionado = form.vendedor.value;
      form.vendedor.innerHTML = '<option value="">Seleccione</option>';
      nombres.forEach(nombre => {
        const opt = document.createElement('option');
        opt.value = nombre;
        opt.textContent = nombre;
        form.vendedor.appendChild(opt);
      });

      // "WhatsApp" lo asigna por código el modo homónimo: tiene que existir siempre.
      asegurarOpcionVendedor('WhatsApp');
      // Reponer lo que el operador (o la carga de un pedido) ya había elegido.
      if (seleccionado) {
        asegurarOpcionVendedor(seleccionado);
        form.vendedor.value = seleccionado;
      }
    })
    .catch(err => {
      console.warn('No se pudo cargar la lista de vendedores desde Google Sheets:', err);
    });
}
cargarVendedoresDesdeSheets();

// === ALIAS: Autocompletar desde el nodo "alias" de Firebase RTDB (+ cache en localStorage) ===
let aliasHistorial = [];      // cache offline en localStorage
let aliasDesdeFirebase = [];  // alias registrados en el nodo "alias" de RTDB

// Convertir un alias a una clave válida para Firebase RTDB.
// Las claves no admiten . # $ / [ ] ; el alias original se guarda como valor.
function aliasAClave(alias) {
  return alias.replace(/[.#$/\[\]]/g, c => '~' + c.charCodeAt(0) + '~');
}

// Crear datalist para autocompletar alias
let datalistAlias = document.getElementById('aliasDatalist');
if (!datalistAlias) {
  datalistAlias = document.createElement('datalist');
  datalistAlias.id = 'aliasDatalist';
  document.body.appendChild(datalistAlias);
}

// Configurar el campo alias para usar el datalist
const aliasField = document.getElementById('alias');
if (aliasField) {
  aliasField.setAttribute('list', 'aliasDatalist');
}

// Reconstruir el datalist combinando Firebase + localStorage, ordenado alfabéticamente
function actualizarDatalistAlias() {
  datalistAlias.innerHTML = '';
  const vistos = new Set();
  const todos = [];
  [...aliasDesdeFirebase, ...aliasHistorial].forEach(alias => {
    const a = (alias || '').trim().toUpperCase();
    if (a !== '' && !vistos.has(a)) {
      vistos.add(a);
      todos.push(a);
    }
  });
  // Orden alfabético
  todos.sort((a, b) => a.localeCompare(b, 'es'));
  todos.forEach(alias => {
    const option = document.createElement('option');
    option.value = alias;
    datalistAlias.appendChild(option);
  });
}

// Cargar historial de alias desde localStorage
function cargarHistorialAliasDesdeLocalStorage() {
  try {
    const aliasGuardados = localStorage.getItem('historialAlias');
    aliasHistorial = aliasGuardados ? JSON.parse(aliasGuardados) : [];
    actualizarDatalistAlias();
  } catch (error) {
    console.error('Error cargando historial de alias desde localStorage:', error);
    aliasHistorial = [];
  }
}

// Suscribirse al nodo "alias" de Firebase RTDB para poblar el datalist
function cargarAliasDesdeFirebase() {
  try {
    db.ref('alias').on('value', snap => {
      const val = snap.val() || {};
      aliasDesdeFirebase = Object.values(val)
        .map(v => (v || '').toString().trim().toUpperCase())
        .filter(v => v !== '');
      actualizarDatalistAlias();
    });
  } catch (error) {
    console.error('Error cargando alias desde Firebase:', error);
  }
}

// Registrar un alias en el nodo "alias" de Firebase (una sola vez, sin duplicados).
// La clave saneada garantiza unicidad: si ya existe, set lo sobrescribe sin duplicar.
function registrarAliasEnFirebase(nuevoAlias) {
  try {
    if (!nuevoAlias || nuevoAlias.trim() === '') return;
    const aliasLimpio = nuevoAlias.trim().toUpperCase();
    db.ref('alias/' + aliasAClave(aliasLimpio)).set(aliasLimpio);
  } catch (error) {
    console.error('Error registrando alias en Firebase:', error);
  }
}

// Guardar alias en localStorage
function guardarAliasEnLocalStorage(nuevoAlias) {
  try {
    if (!nuevoAlias || nuevoAlias.trim() === '') return;

    const aliasLimpio = nuevoAlias.trim().toUpperCase();

    // Registrar en el nodo "alias" de Firebase (fuente compartida)
    registrarAliasEnFirebase(aliasLimpio);

    // Cargar historial actual
    let historial = [];
    const aliasGuardados = localStorage.getItem('historialAlias');
    if (aliasGuardados) {
      historial = JSON.parse(aliasGuardados);
    }

    // Remover el alias si ya existe para evitar duplicados
    historial = historial.filter(alias => alias !== aliasLimpio);

    // Agregar el nuevo alias al principio
    historial.unshift(aliasLimpio);

    // Mantener solo los últimos 15 alias
    if (historial.length > 15) {
      historial = historial.slice(0, 15);
    }

    // Guardar en localStorage
    localStorage.setItem('historialAlias', JSON.stringify(historial));

    // Actualizar el historial en memoria y el datalist
    aliasHistorial = historial;
    actualizarDatalistAlias();

  } catch (error) {
    console.error('Error guardando alias en localStorage:', error);
  }
}

// Cargar historial de alias al inicializar
cargarHistorialAliasDesdeLocalStorage();
// Suscribirse al nodo "alias" de Firebase RTDB
cargarAliasDesdeFirebase();

// Al salir del input nombre, autocompletar SÓLO si el cliente ya está registrado.
// Si no lo está, no se hace nada: los clientes de paso viven únicamente dentro del
// pedido (nodo "pedidos"). El alta en el nodo "clientes" la decide el operador con
// el botón Registrar.
form.nombre.addEventListener('blur', function() {
  const nombre = form.nombre.value.trim().toLowerCase();
  if (!nombre || nombre === 'n/a') return;
  if (clientesPorNombre[nombre]) {
    // Autocompletar datos
    const cli = clientesPorNombre[nombre];
    form.telefono.value = cli.telefono || '';
    form.direccion.value = cli.direccion || '';
    form.dni.value = cli.dni || '';
    form.email.value = cli.email || '';
    // Restaurar tipoCliente si existe
    if (cli.tipoCliente) {
      const radio = document.querySelector(`input[name="tipoCliente"][value="${cli.tipoCliente}"]`);
      if (radio) radio.checked = true;
      tipoCliente = cli.tipoCliente; // <-- ACTUALIZAR VARIABLE INTERNA
    }
  }
});

// Modal vistoso para registrar o editar cliente
function mostrarModalRegistroCliente(nombrePrellenado = '', telefonoPrellenado, direccionPrellenado, dniPrellenado, emailPrellenado, tipoClientePrellenado = 'mayorista', esEdicion = false) {
  let modal = document.getElementById('modalRegistroCliente');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modalRegistroCliente';
    modal.innerHTML = `
      <div style="position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;z-index:9999;">
        <div style="background:#fff;padding:32px 24px;border-radius:12px;box-shadow:0 4px 32px #0002;min-width:320px;max-width:90vw;">
          <h2 style='color:#6c4eb6;margin-bottom:16px;'>${esEdicion ? 'Editar cliente' : 'Registrar nuevo cliente'}</h2>
          <form id='formNuevoCliente'>
            <div style='margin-bottom:10px;'><input type='text' name='nombre' placeholder='Nombre' required style='width:95%;padding:8px;' value="${nombrePrellenado||''}"></div>
            <div style='margin-bottom:10px;'><input type='text' name='telefono' placeholder='Teléfono' style='width:95%;padding:8px;' value="${telefonoPrellenado||''}"></div>
            <div style='margin-bottom:10px;'><input type='text' name='direccion' placeholder='Dirección' style='width:95%;padding:8px;' value="${direccionPrellenado||''}"></div>
            <div style='margin-bottom:10px;'><input type='text' name='dni' placeholder='DNI' style='width:95%;padding:8px;' value="${dniPrellenado||''}"></div>
            <div style='margin-bottom:10px;'><input type='email' name='email' placeholder='Email' style='width:95%;padding:8px;' value="${emailPrellenado||''}"></div>
            <div style='margin-bottom:10px;display:flex;align-items:center;gap:10px;'>
              <label style='font-weight:bold;'>Tipo de Cliente:</label>
              <span id='tipoClienteModalTexto' style='padding:4px 10px;border-radius:999px;background:#f0ecfa;color:#6c4eb6;font-weight:600;'>${esEdicion && tipoClientePrellenado === 'admin' ? 'Administrador' : 'Mayorista'}</span>
            </div>
            <div style='display:flex;gap:10px;justify-content:flex-end;'>
              <button type='button' id='cancelarNuevoCliente' style='background:#eee;color:#333;padding:8px 16px;border:none;border-radius:4px;'>Cancelar</button>
              <button type='submit' style='background:#6c4eb6;color:#fff;padding:8px 16px;border:none;border-radius:4px;'>${esEdicion ? 'Guardar' : 'Registrar'}</button>
            </div>
          </form>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  } else {
    modal.style.display = 'flex';
    modal.querySelector('input[name="nombre"]').value = nombrePrellenado||'';
    if (typeof telefonoPrellenado !== 'undefined') modal.querySelector('input[name="telefono"]').value = telefonoPrellenado||'';
    if (typeof direccionPrellenado !== 'undefined') modal.querySelector('input[name="direccion"]').value = direccionPrellenado||'';
    if (typeof dniPrellenado !== 'undefined') modal.querySelector('input[name="dni"]').value = dniPrellenado||'';
    if (typeof emailPrellenado !== 'undefined') modal.querySelector('input[name="email"]').value = emailPrellenado||'';
    // Cambiar título, chip de tipo y botón
    const tipoTexto = modal.querySelector('#tipoClienteModalTexto');
    if (tipoTexto) tipoTexto.textContent = (esEdicion && tipoClientePrellenado === 'admin') ? 'Administrador' : 'Mayorista';
    modal.querySelector('h2').textContent = esEdicion ? 'Editar cliente' : 'Registrar nuevo cliente';
    modal.querySelector('button[type="submit"]').textContent = esEdicion ? 'Guardar' : 'Registrar';
  }
  // Cerrar al hacer clic en el fondo oscuro (fuera del cuadro)
  const overlayDiv = modal.firstElementChild;
  overlayDiv.onclick = function(e) {
    if (e.target === overlayDiv) { modal.remove(); cleanup(); }
  };
  // Cancelar
  modal.querySelector('#cancelarNuevoCliente').onclick = function() {
    modal.remove();
    cleanup();
  };
  // Registrar/Guardar.
  // Todo registro del nodo "clientes" se guarda como tipoCliente "mayorista".
  // La única excepción es editar una cuenta interna ya marcada como "admin":
  // degradarla a mayorista la sacaría del listado del modo Administrador.
  modal.querySelector('#formNuevoCliente').onsubmit = function(e) {
    e.preventDefault();
    const nombre = this.nombre.value.trim();
    const telefono = this.telefono.value.trim();
    const direccion = this.direccion.value.trim();
    const dni = this.dni.value.trim();
    const email = this.email.value.trim();
    const tipoCliente = (esEdicion && tipoClientePrellenado === 'admin') ? 'admin' : 'mayorista';
    if (!nombre) return;

    // El pedido guarda su propia copia de los datos del cliente: al cerrar el
    // modal se vuelca todo al formulario para que la venta salga con ellos.
    function volcarEnFormulario() {
      form.nombre.value = nombre;
      form.telefono.value = telefono;
      form.direccion.value = direccion;
      form.dni.value = dni;
      form.email.value = email;
      const radio = document.querySelector(`input[name="tipoCliente"][value="${tipoCliente}"]`);
      if (radio) radio.checked = true;
    }

    function cerrarModal() {
      modal.remove();
      cleanup();
    }

    // Buscar el cliente por nombre (case-insensitive) en el nodo "clientes"
    const nombreKey = nombre.toLowerCase();
    db.ref('clientes').once('value').then(snap => {
      let clienteId = null;
      snap.forEach(child => {
        const cli = child.val();
        if (cli && cli.nombre && cli.nombre.toLowerCase() === nombreKey) clienteId = child.key;
      });

      const datos = { nombre, telefono, direccion, dni, email, tipoCliente };

      if (esEdicion) {
        // Si el nombre no corresponde a ningún cliente registrado, la edición
        // sólo afecta a los datos del pedido en curso.
        if (!clienteId) {
          volcarEnFormulario();
          cerrarModal();
          return;
        }
        return db.ref('clientes/' + clienteId).update(datos).then(() => {
          cargarClientes();
          volcarEnFormulario();
          cerrarModal();
        });
      }

      // Alta: nunca se duplica un cliente ya registrado con el mismo nombre.
      if (clienteId) {
        const actualizar = confirm(`Ya existe un cliente registrado con el nombre "${nombre}".\n\n¿Desea actualizar sus datos con los que acaba de ingresar?`);
        if (!actualizar) return;
        return db.ref('clientes/' + clienteId).update(datos).then(() => {
          cargarClientes();
          volcarEnFormulario();
          cerrarModal();
          showPopup('Cliente actualizado.', '✅', true);
        });
      }

      return db.ref('clientes').push({ ...datos, registro: 'Local' }).then(() => {
        cargarClientes();
        volcarEnFormulario();
        cerrarModal();
        showPopup('Cliente registrado.', '✅', true);
      });
    }).catch(() => {
      showPopup('No se pudo guardar el cliente. Revise la conexión e intente nuevamente.', '❗', false);
    });
  };
  // Soporte Enter/Escape
  function keyHandler(e) {
    if (!document.getElementById('modalRegistroCliente')) return;
    // Solo confirmar con Enter si el foco está en un input o textarea
    if (e.key === 'Enter' && document.activeElement.tagName !== 'BUTTON') {
      modal.querySelector('button[type="submit"]').click();
      e.preventDefault();
    } else if (e.key === 'Escape') {
      modal.remove();
      cleanup();
      e.preventDefault();
    }
  }
  function cleanup() {
    document.removeEventListener('keydown', keyHandler);
  }
  document.addEventListener('keydown', keyHandler);
}

  // ====================================================================
  // IMPRESIÓN ESC-POS (fuente nativa FONTA de la 3nStar RPT008 vía QZ Tray)
  // ====================================================================
  // El navegador no puede mandar bytes ESC-POS por window.print() (siempre
  // rasteriza). QZ Tray es una app local que recibe la orden desde la web y
  // envía texto crudo a la impresora, que lo dibuja con su generador interno
  // FONTA: nítido y definido, no un mapa de bits.

  // Nombre exacto de la impresora como figura en Windows.
  // null = usar la impresora por defecto del sistema.
  const POS_PRINTER_NAME = 'POS-80C';

  // Ancho de línea de FONTA a 72 mm según el selftest: 48 caracteres.
  const POS_COLS = 48;

  // Helper: convierte cualquier valor a entero formateado es-AR (sin decimales)
  function soloEntero(val) {
    if (val === null || val === undefined || val === '') return '';
    let n;
    if (typeof val === 'number') {
      n = val;
    } else {
      const clean = String(val).replace(/[^\d,.-]/g, '');
      // Formato es-AR: '.' separador de miles, ',' decimal
      n = parseFloat(clean.replace(/\./g, '').replace(',', '.'));
    }
    if (isNaN(n)) return String(val);
    return Math.round(n).toLocaleString('es-AR', { maximumFractionDigits: 0 });
  }

  // Helper: últimos 5 dígitos de cada código de barras asignado
  function ultimos5BC(cb) {
    if (!cb) return '';
    return String(cb)
      .split(',')
      .map(s => s.replace(/\D/g, '').slice(-5))
      .filter(Boolean)
      .join(' ');
  }

  // Normaliza a ASCII/PC437 (Page0, code page por defecto de la impresora):
  // sin esto, acentos y ñ saldrían como basura en modo texto.
  function posPlain(val) {
    if (val === null || val === undefined) return '';
    return String(val)
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[¿¡]/g, '')
      .replace(/[^\x00-\x7F]/g, '');
  }

  // Helpers de formato a 48 columnas
  function posSep() { return '-'.repeat(POS_COLS) + '\n'; }

  function posFila(izq, der) {
    izq = posPlain(izq); der = posPlain(der);
    const espacio = POS_COLS - izq.length - der.length;
    if (espacio < 1) {
      izq = izq.slice(0, Math.max(0, POS_COLS - der.length - 1));
      return izq + ' ' + der + '\n';
    }
    return izq + ' '.repeat(espacio) + der + '\n';
  }

  function posWrap(texto) {
    texto = posPlain(texto);
    let out = '';
    while (texto.length > POS_COLS) {
      out += texto.slice(0, POS_COLS) + '\n';
      texto = texto.slice(POS_COLS);
    }
    return out + texto + '\n';
  }

  // Comandos ESC-POS como bytes hex / texto plano (formato que entiende QZ)
  const escCmd = (hex) => ({ type: 'raw', format: 'hex', data: hex });
  const escTxt = (s) => ({ type: 'raw', format: 'plain', data: s });

  // Construye el documento ESC-POS completo del recibo.
  // conLogo=false omite la imagen (el logo es lo único raster; si la
  // impresora/QZ no lo puede procesar, igual sale todo el texto nativo).
  function construirESCPOS(d, conLogo) {
    const data = [];
    data.push(escCmd('1B40'));   // ESC @  -> reset
    data.push(escCmd('1B7400')); // ESC t 0 -> code page PC437 (Page0)
    data.push(escCmd('1B5200')); // ESC R 0 -> juego de caracteres USA

    // Encabezado centrado
    data.push(escCmd('1B6101')); // centrar
    if (conLogo) {
      try {
        const logoUrl = new URL('logo.png', window.location.href).href;
        data.push({ type: 'raw', format: 'image', flavor: 'file', data: logoUrl,
                    options: { language: 'ESCPOS', dotDensity: 'double' } });
        data.push(escTxt('\n'));
      } catch (e) { /* sin logo, el ticket igual sale */ }
    } else {
      data.push(escCmd('1D2111')); // GS ! 0x11 -> doble alto y ancho
      data.push(escTxt('HOMEPOINT\n'));
      data.push(escCmd('1D2100')); // GS ! 0x00 -> tamaño normal
    }
    data.push(escTxt('\n'));
    data.push(escTxt('Velez Sarsfield 4127, Munro\n'));
    data.push(escTxt('Tel. 11 2189-1006\n'));
    data.push(escTxt('\n')); // línea en blanco antes del título
    data.push(escCmd('1B4501')); // negrita on
    data.push(escTxt('PRESUPUESTO\n'));
    data.push(escCmd('1B4500')); // negrita off
    data.push(escTxt(posPlain(d.fecha) + '\n'));

    // Cuerpo alineado a la izquierda
    data.push(escCmd('1B6100'));
    data.push(escTxt(posSep()));
    // Encabezado de la operación: un cambio no es una venta y el ticket tiene que decirlo.
    if (d.esCambio) {
      data.push(escCmd('1B4501'));
      data.push(escTxt(posWrap('*** CAMBIO / DEVOLUCION ***')));
      data.push(escCmd('1B4500'));
      if (d.pedidosOrigen && d.pedidosOrigen.length) {
        data.push(escTxt(posWrap('Ref. ticket: ' + d.pedidosOrigen.map(idCortoPedido).join(', '))));
      }
      data.push(escTxt(posSep()));
    }
    data.push(escTxt(posWrap('Nombre: ' + d.nombre)));
    data.push(escTxt(posWrap('Telefono: ' + d.telefono)));
    data.push(escTxt(posSep()));

    d.items.forEach(it => {
      const cant = it.cantidad || 0;
      const vU = it.valorU || 0;
      const tipo = it.tipoLinea || 'VENTA';
      const bc = ultimos5BC(it.codigoBarras);
      const prefijo = tipo === 'DEVOLUCION' ? '(-) ' : tipo === 'GARANTIA' ? '(G) ' : '';
      data.push(escCmd('1B4501'));
      data.push(escTxt(posWrap(prefijo + (it.nombre || '').toUpperCase())));
      data.push(escCmd('1B4500'));
      const importe = tipo === 'GARANTIA'
        ? 'SIN CARGO'
        : soloEntero(typeof it.totalLinea === 'number' ? it.totalLinea : cant * vU);
      data.push(escTxt(posFila(cant + ' x ' + soloEntero(vU), importe)));
      data.push(escTxt(posWrap('COD.' + (it.codigo || '') + (bc ? ' - ' + bc : ''))));
    });

    data.push(escTxt(posSep()));
    data.push(escTxt(posFila('Subtotal', soloEntero(d.subtotal))));
    data.push(escTxt(posFila('Medio de Pago', d.medioPago)));
    if (parseFloat(d.recargo)) data.push(escTxt(posFila('Recargo', soloEntero(d.recargo))));
    if (parseFloat(d.descuento)) data.push(escTxt(posFila('Descuento', soloEntero(d.descuento))));
    if (parseFloat(d.envio)) data.push(escTxt(posFila('Costo de Envio', soloEntero(d.envio))));
    data.push(escCmd('1B4501'));
    data.push(escTxt(posFila(rotuloTotalComprobante(d), '$ ' + soloEntero(d.totalFinal))));
    data.push(escCmd('1B4500'));

    data.push(escTxt(posSep()));
    data.push(escCmd('1B6101')); // centrar leyenda
    data.push(escCmd('1B4501'));
    data.push(escTxt(posWrap('- DOCUMENTO NO VALIDO COMO FACTURA -')));
    data.push(escCmd('1B4500'));

    // ID de pedido (últimos 8 caracteres en mayúscula), discreto y centrado al pie del ticket
    if (d.pedidoId) {
      data.push(escTxt('\n'));
      data.push(escTxt(posWrap(String(d.pedidoId).slice(-8).toUpperCase())));
    }

    data.push(escTxt('\n\n\n'));
    data.push(escCmd('1D564203')); // GS V 66 3 -> avanza y corta (parcial)
    return data;
  }

  // QZ Tray — certificado propio (importar C:\Users\alero\.claude\qz-cert.pem en Site Manager para eliminar el diálogo).
  let qzConfigurado = false;
  function configurarQZ() {
    if (qzConfigurado || typeof qz === 'undefined') return;
    const QZ_CERT = `-----BEGIN CERTIFICATE-----
MIIDXTCCAkWgAwIBAgIUPMCoqhpYQ4z55zCYiyngpH47VAwwDQYJKoZIhvcNAQEL
BQAwPjELMAkGA1UEBhMCQVIxEjAQBgNVBAoMCUhvbWVQb2ludDEbMBkGA1UEAwwS
SG9tZVBvaW50IEFkbWluIFFaMB4XDTI2MDUxOTE2NTAxOFoXDTM2MDUxNjE2NTAx
OFowPjELMAkGA1UEBhMCQVIxEjAQBgNVBAoMCUhvbWVQb2ludDEbMBkGA1UEAwwS
SG9tZVBvaW50IEFkbWluIFFaMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKC
AQEA0G3Pek2EDxsUuyRoqYttHqkmudOhJ56FrUqqdks01dB52+kfoElM995N4Xqm
GkBTkPLV30lUkEF1W5xKdCe3DcTp0qcZpIDf2468SKlvyi4WI9ji8rIBB4b/jN6l
ECKUooi4iEeihKQ2WY2o7d7vhD52ITvJ9rKXJ1TWe9yyaW2sz3b7DfGKqZv+VwWY
bQfZwLtymkGOi0IIplHwWmRoQdrl3rXE8tOIeB7Br15vKbIoXGwkV6W4rVmg+ngA
M0BYqmcg08hRXZqUZ1nmyNsRrXijTv6D8qLvefO7D3eqIKXs0okmacGWZzfGLGnD
YlEXTAVnMNmolKaRSVNVbF230wIDAQABo1MwUTAdBgNVHQ4EFgQUJbmYNOzALjUF
zMY93JIwa2M6bi8wHwYDVR0jBBgwFoAUJbmYNOzALjUFzMY93JIwa2M6bi8wDwYD
VR0TAQH/BAUwAwEB/zANBgkqhkiG9w0BAQsFAAOCAQEAYO72+pxaqZifKkimB0tw
mvKuqEfOOiXBawh7xBlLaTvHDaVH6v6ABqj7S73vSRBiD00oFKf5FQ42I+O1bUoN
QYdIsxA2Q8ka7HaxMTB5v4ZBvbyXWLrRIavwY5XI2JWzArvZ8oTKB/gHF5lo9yDI
nfvKQ9SL9y+GfwHOGkmUaw2ViScT17KdMJzSWoE37Qasp50Du+boRdmOgL0fN4nL
zRY73MMEek1ny+DkbJ2OR7vmF2FSHaPqJzZb+UCINC3Pbf5KxqUPn+K2CEfT53hW
3ALNhGIFw9E7pN6IE5LEdNkZCwpZRDksRo3UeBVcowsdmKzZ7Uwbe1dzxygzaLxX
tw==
-----END CERTIFICATE-----`;
    const QZ_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDQbc96TYQPGxS7
JGipi20eqSa506EnnoWtSqp2SzTV0Hnb6R+gSUz33k3heqYaQFOQ8tXfSVSQQXVb
nEp0J7cNxOnSpxmkgN/bjrxIqW/KLhYj2OLysgEHhv+M3qUQIpSiiLiIR6KEpDZZ
jajt3u+EPnYhO8n2spcnVNZ73LJpbazPdvsN8Yqpm/5XBZhtB9nAu3KaQY6LQgim
UfBaZGhB2uXetcTy04h4HsGvXm8psihcbCRXpbitWaD6eAAzQFiqZyDTyFFdmpRn
WebI2xGteKNO/oPyou9587sPd6ogpezSiSZpwZZnN8YsacNiURdMBWcw2aiUppFJ
U1VsXbfTAgMBAAECggEACsutQ+3w6aFi9QCBRUrZ940WWuipv7YXwW6NHrxte6el
MC1GfJRfXrVOfl/Oa6yqR2c0ibCwJxqk2/5f4t1Nv3JUFBugmeMs9R/TA8Z26ldx
wSCSPLTYlc25vc+oaAoKfdKsEC75rXod8IyEU/HIoSZlEvqYTuVYK+ragybevNQf
69UNrSovGjHuwDj3+tyZh0V7/Tp9Ch3iDRxFEZeqXtH0C8g4SxR0pTafyAIasyhV
q6Y2ETEJWMVNUIIyrqtvWIQsewV6ykwUns09Qi6mFbBtz8uCLPsSyV7FccpOuWEk
evL37yDL6HwdzA/xDnBST+eZeaRqBkB9rZs4W0kjpQKBgQD7fBZdudKO1/63AND4
0DeVW/g3XZ6JiqBNFTtY1Q3pZRKbJhS+fSrZdReI7/7SZg9Tpgp9L6ih0aGe/Xqm
Utz2SHQEk9D5nr8aTmn6E/YK956XuW1h6OGAdvxYfnnJibMIzT6yVVDYlFY1olj/
VzXsmT0NM1JO/T4MCCfAKicEfwKBgQDUK9LU5NE/SaLwXslUK+jccTSP6cGUn+D0
2IVTsccrh1lnD1ZlMoUR+5RTXAV5cyBzDL3ogvhpHTTaS8LGrJsw6c9wUvlbAVis
hZ9WhXcC/U62ww5wZXFb+ShrYqrOLIv1Ul62Ixdoi2wofUOzT13tyGVgfuAtdeJ5
QY4US/FSrQKBgQCKNi5MoH26B7dzeD1hIX4K1hrawtcInGlxM8QEFEOrC+Nn5Uvt
TPkpvhKLLesMUw8FV/HXz0OMe5upt4Gau1u49yTcBykIp1g76vCPgjzs1h4RINWe
w9B7O+l/8TKZstX0dmiIth7SiOPAYlMrMhDu0WEeSiBoTQG2txyxnfkHnQKBgHP9
kUD55rrmksE90GrHpoH9EXMro7yQuvaf+CONKQlO8T06UUz5lW4DT09TG1sN6Ut8
R8X487zjTqWYjV73tc/DwrfxZIiv775BPp6aUDm+KW4YrKgdjR9u0v4B7sbP66Ot
6EFCZeWtcu+fq4c3eG4qA+IA+qVfsPQBNp859S/xAoGBALKK0Wx/OHaWPrAaThP0
swiTwxojtYcW2WoyuWXzJClYn1id6V+kpFuDiLDJjg6ngdeXvZ9BHRY8J/eWe1JE
0YPZcP39H64LvTr+s65TtMrhCs5eNKd5hiGAB0T5Ctardy4f5liqQ8EqNa7YzcR/
8xJFkCasp5SwyHnKysUl8ViY
-----END PRIVATE KEY-----`;
    qz.security.setCertificatePromise((resolve) => resolve(QZ_CERT));
    qz.security.setSignatureAlgorithm('SHA512');
    qz.security.setSignaturePromise(function(toSign) {
      return function(resolve, reject) {
        const pem = QZ_KEY.replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
        const der = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
        crypto.subtle.importKey('pkcs8', der.buffer,
          { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-512' }, false, ['sign'])
          .then(function(key) {
            return crypto.subtle.sign('RSASSA-PKCS1-v1_5', key,
              new TextEncoder().encode(toSign));
          })
          .then(function(sig) {
            const bytes = new Uint8Array(sig);
            let str = '';
            for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
            resolve(btoa(str));
          })
          .catch(reject);
      };
    });
    qzConfigurado = true;
  }

  async function conectarQZ() {
    if (typeof qz === 'undefined') throw new Error('La librería de QZ Tray no se cargó');
    configurarQZ();
    if (qz.websocket.isActive()) return;
    await qz.websocket.connect();
  }

  async function seleccionarImpresoraPOS() {
    if (POS_PRINTER_NAME) return POS_PRINTER_NAME;
    let lista = await qz.printers.find();
    if (!Array.isArray(lista)) lista = [lista];
    const m = lista.find(n => /3n[\s-]?star|rpt[\s-]?008|pos[\s-]?80|thermal|ticket/i.test(n));
    if (m) return m;
    return await qz.printers.getDefault();
  }

  async function imprimirReciboESCPOS(d) {
    await conectarQZ();
    const printerName = await seleccionarImpresoraPOS();
    if (!printerName) throw new Error('No se encontró ninguna impresora');
    const config = qz.configs.create(printerName, { encoding: 'CP437' });
    try {
      // Intento 1: con logo (imagen raster)
      await qz.print(config, construirESCPOS(d, true));
    } catch (eLogo) {
      // Intento 2: sin logo (solo texto nativo). Si esto también falla,
      // se propaga el error y el llamador ofrece el respaldo HTML.
      console.warn('Print con logo falló, reintentando sin logo:', eLogo);
      await qz.print(config, construirESCPOS(d, false));
    }
  }

  // Respaldo: impresión HTML clásica (rasterizada por el navegador).
  function imprimirReciboHTML(d) {
    let itemsHtml = '';
    d.items.forEach(it => {
      const cant = it.cantidad || 0;
      const vU = it.valorU || 0;
      const tipo = it.tipoLinea || 'VENTA';
      const bc = ultimos5BC(it.codigoBarras);
      const prefijo = tipo === 'DEVOLUCION' ? '(-) ' : tipo === 'GARANTIA' ? '(G) ' : '';
      const importe = tipo === 'GARANTIA'
        ? 'SIN CARGO'
        : soloEntero(typeof it.totalLinea === 'number' ? it.totalLinea : cant * vU);
      itemsHtml += `
        <div class="item">
          <div class="item-nombre">${prefijo}${(it.nombre || '').toUpperCase()}</div>
          <div class="item-linea">
            <span>${cant} x ${soloEntero(vU)}</span>
            <span>${importe}</span>
          </div>
          <div class="item-cod">COD.${it.codigo || ''}${bc ? ' - ' + bc : ''}</div>
        </div>`;
    });
    const reciboHtml = `
      <html>
      <head>
        <title>Orden de Pedido</title>
        <style>
          /* 3nStar RPT008: ancho de papel 80mm, área imprimible 72mm (ver selftest).
             El cuadro se limita a 72mm para que nada se recorte ni se reescale. */
          @page { size: 80mm auto; margin: 0; }
          html, body { margin: 0; padding: 0; }
          /* Tamaño de fuente único para todo el ticket: la variación de
             tamaños se elimina; solo se conserva negrita para jerarquía. */
          body { font-family: 'Courier New', Courier, monospace; font-size: 12px; line-height: 1.35; color: #000; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .recibo-box { width: 72mm; max-width: 72mm; margin: 0 auto; padding: 6px 4px; background: #fff; box-sizing: border-box; }
          .logo { display: block; margin: 0 auto 6px auto; max-width: 60mm; max-height: 22mm; object-fit: contain; }
          .local { text-align: center; }
          .titulo { text-align: center; font-weight: bold; margin: 1.4em 0 4px 0; }
          .fecha { text-align: center; margin-bottom: 6px; }
          .datos { }
          .sep { border: none; border-top: 1px dashed #000; margin: 6px 0; }
          .item { margin-bottom: 6px; }
          .item-nombre { font-weight: bold; word-break: break-word; }
          .item-linea { display: flex; justify-content: space-between; }
          .item-cod { color: #000; }
          .tot { padding: 2px 2px; }
          .tot-fila { display: flex; justify-content: space-between; padding: 1px 0; }
          .tot-final { font-weight: bold; }
          .legend { text-align: center; font-weight: bold; margin-top: 12px; }
          .pedido-id { text-align: center; margin-top: 10px; font-size: 9px; color: #555; }
          @media print { button { display: none !important; } }
        </style>
      </head>
      <body>
        <div class='recibo-box'>
          <img src="logo.png" alt="Logo" class="logo">
          <div class="local">Vélez Sársfield 4127, Munro</div>
          <div class="local">Tel. 11 2189-1006</div>
          <div class="titulo">${d.esCambio ? '*** CAMBIO / DEVOLUCION ***' : 'ORDEN DE PEDIDO'}</div>
          <div class="fecha">${d.fecha}</div>
          <hr class="sep">
          <div class="datos">
            ${d.esCambio && d.pedidosOrigen && d.pedidosOrigen.length ? `<div>Ref. ticket: ${d.pedidosOrigen.map(idCortoPedido).join(', ')}</div>` : ''}
            <div>Nombre: ${d.nombre}</div>
            <div>Telefono: ${d.telefono}</div>
          </div>
          <hr class="sep">
          ${itemsHtml}
          <hr class="sep">
          <div class="tot">
            <div class="tot-fila"><span>Subtotal</span><span>${soloEntero(d.subtotal)}</span></div>
            <div class="tot-fila"><span>Medio de Pago</span><span>${d.medioPago}</span></div>
            ${parseFloat(d.recargo) ? `<div class="tot-fila"><span>Recargo</span><span>${soloEntero(d.recargo)}</span></div>` : ''}
            ${parseFloat(d.descuento) ? `<div class="tot-fila"><span>Descuento</span><span>${soloEntero(d.descuento)}</span></div>` : ''}
            ${parseFloat(d.envio) ? `<div class="tot-fila"><span>Costo de Envio</span><span>${soloEntero(d.envio)}</span></div>` : ''}
            <div class="tot-fila tot-final"><span>${rotuloTotalComprobante(d)}</span><span>$ ${soloEntero(d.totalFinal)}</span></div>
          </div>
          <hr class="sep">
          <div class="legend">POR FAVOR, RECUERDE REVISAR EL ESTADO DE LA MERCADERIA ANTES DE RETIRARSE</div>
          ${d.pedidoId ? `<div class="pedido-id">${String(d.pedidoId).slice(-8).toUpperCase()}</div>` : ''}
        </div>
        <script>window.onload = function(){ window.print(); }<\/script>
      </body>
      </html>
    `;
    // Una única pasada por posPlain() normaliza TODO el ticket a ASCII/PC437.
    const w = window.open('', '_blank', 'width=600,height=800');
    w.document.write(posPlain(reciboHtml));
    w.document.close();
  }

  // Botón Imprimir
  const imprimirBtn = document.querySelector('.actions button.secondary');
  if (imprimirBtn) {
    imprimirBtn.addEventListener('click', function() {
      generarReciboYImprimir();
    });
  }

  // Toma una "foto" sincrónica de los datos del formulario ANTES de cualquier
  // await (los llamadores hacen form.reset() / items=[] justo después), y
  // dispara la impresión asíncrona con ese snapshot.
  function generarReciboYImprimir(pedidoId) {
    const d = {
      nombre: form.nombre.value.trim(),
      telefono: form.telefono.value.trim(),
      medioPago: form.medioPago.value,
      subtotal: form.subtotal.value,
      recargo: form.recargo.value,
      descuento: form.descuento.value,
      envio: form.envio.value,
      totalFinal: form.totalFinal.value,
      pedidoId: pedidoId || '',
      fecha: new Date().toLocaleString('es-AR', { hour12: false }),
      esCambio: items.some(esLineaCambio),
      pedidosOrigen: [...new Set(items.filter(esLineaCambio).map(it => it.pedidoOrigenId).filter(Boolean))],
      items: items.map(it => ({
        nombre: it.nombre, codigo: it.codigo, codigoBarras: it.codigoBarras,
        cantidad: it.cantidad, valorU: it.valorU, tipoLinea: it.tipoLinea || 'VENTA',
        totalLinea: totalLinea(it)
      }))
    };
    imprimirComprobante(d);
  }

  // Rótulo del importe final según el signo de la operación.
  function rotuloTotalComprobante(d) {
    if (!d.esCambio) return 'TOTAL';
    const total = parseImporte(d.totalFinal);
    if (total > 0) return 'DIFERENCIA';
    if (total < 0) return 'A DEVOLVER';
    return 'SIN CARGO';
  }

  async function imprimirComprobante(d) {
    try {
      // Camino principal: modo texto ESC-POS con la fuente nativa FONTA
      await imprimirReciboESCPOS(d);
    } catch (e) {
      // El fallback NO es silencioso: mostramos el motivo real para poder
      // diagnosticar por qué no entró el modo ESC-POS.
      console.error('Fallo impresión ESC-POS:', e);
      let motivo = (e && e.message) ? e.message : String(e);
      if (typeof qz === 'undefined') {
        motivo = 'La librería de QZ Tray no se cargó (¿sin internet o CDN bloqueado?).';
      } else if (!qz.websocket.isActive()) {
        motivo = 'No se pudo conectar con QZ Tray. Verificá que QZ Tray esté instalado y CORRIENDO (ícono en la bandeja del sistema).\n\nDetalle técnico: ' + motivo;
      }
      const usarHTML = confirm(
        'No se pudo imprimir en modo ESC-POS (fuente nativa).\n\n' +
        motivo + '\n\n' +
        '¿Querés imprimir con el método HTML de respaldo (menos nítido)?'
      );
      if (usarHTML) imprimirReciboHTML(d);
    }
  }

  // Inicializar tabla vacía
  renderItems();

  // Mostrar/ocultar alias y comprobante de transferencia según medio de pago
  function actualizarVisibilidadComprobanteTransferencia() {
    const aliasRow = document.getElementById('aliasRow');
    if (!aliasRow) return;
    if (form.medioPago.value === 'Transferencia' || form.medioPago.value === 'Parcial') {
      aliasRow.style.display = '';
    } else {
      aliasRow.style.display = 'none';
      // El alias solo aplica a Transferencia/Parcial: limpiarlo del formulario
      // para que no se guarde en Firebase con otros medios de pago.
      if (form.alias) form.alias.value = '';
    }
  }
  // Ejecutar al cargar
  actualizarVisibilidadComprobanteTransferencia();
  // Ejecutar al cambiar medio de pago
  form.medioPago.addEventListener('change', actualizarVisibilidadComprobanteTransferencia);

  // === CONVERTIR ALIAS A MAYÚSCULAS ===
  const aliasInput = document.getElementById('alias');
  if (aliasInput) {
    aliasInput.addEventListener('input', function() {
      // Guardar la posición del cursor
      const start = this.selectionStart;
      const end = this.selectionEnd;
      // Convertir a mayúsculas
      this.value = this.value.toUpperCase();
      // Restaurar la posición del cursor SOLO si no es tipo number
      if (this.type !== 'number') {
        this.setSelectionRange(start, end);
      }
    });
  }

  // === MODAL CONTRASEÑA PARA MODIFICAR PEDIDO ===
  // Agregar estilos para el modal de contraseña (extraído del HTML de eliminación)
  const styleModalPassword = document.createElement('style');
  styleModalPassword.innerHTML = `
    #modalPassword {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(0,0,0,0.3);
      z-index: 1000;
      align-items: center;
      justify-content: center;
    }
    #modalPassword > div {
      background: #fff;
      border-radius: 8px;
      padding: 24px;
      min-width: 300px;
      box-shadow: 0 2px 16px #0002;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    #modalPassword input[type="password"] {
      padding: 8px;
      border-radius: 4px;
      border: 1px solid #ccc;
      margin-bottom: 16px;
      width: 100%;
    }
    #modalPassword .modal-btns {
      display: flex;
      gap: 10px;
    }
    #modalPassword .modal-btns button {
      color: #fff;
      border: none;
      border-radius: 4px;
      padding: 8px 16px;
      cursor: pointer;
    }
    #modalPassword .modal-btns .eliminar {
      background: #f44336;
    }
    #modalPassword .modal-btns .cancelar {
      background: #888;
    }
    #modalPassword .msg-error {
      color: #f44336;
      margin-top: 10px;
      display: none;
    }
  `;
  document.head.appendChild(styleModalPassword);

  function mostrarModalPasswordEdicion(onConfirm) {
    let modal = document.getElementById('modalPassword');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'modalPassword';
      modal.innerHTML = `
        <div>
          <h3 style="color:#4b2e83; margin-bottom:16px;">Confirmar modificación</h3>
          <p style="margin-bottom:12px; color:#333;">Ingrese la contraseña para modificar el pedido:</p>
          <input id="inputPasswordEdicion" type="password" placeholder="Contraseña">
          <div class="modal-btns">
            <button id="btnConfirmarEdicion" class="eliminar">Modificar</button>
            <button id="btnCancelarEdicion" class="cancelar">Cancelar</button>
          </div>
          <span id="msgPasswordErrorEdicion" class="msg-error">Contraseña incorrecta</span>
        </div>
      `;
      document.body.appendChild(modal);
    } else {
      modal.style.display = 'flex';
      modal.querySelector('#inputPasswordEdicion').value = '';
      modal.querySelector('#msgPasswordErrorEdicion').style.display = 'none';
    }
    modal.style.display = 'flex';
    const input = modal.querySelector('#inputPasswordEdicion');
    input.focus();
    // Bandera para evitar doble ejecución
    let accionRealizada = false;
    function keyHandler(e) {
      if (modal.style.display !== 'flex') return;
      if (e.key === 'Enter') {
        modal.querySelector('#btnConfirmarEdicion').click();
        e.preventDefault();
      } else if (e.key === 'Escape') {
        modal.querySelector('#btnCancelarEdicion').click();
        e.preventDefault();
      }
    }
    document.addEventListener('keydown', keyHandler);
    function cleanup() {
      document.removeEventListener('keydown', keyHandler);
    }
    modal.querySelector('#btnConfirmarEdicion').onclick = function() {
      if (accionRealizada) return;
      const pass = input.value;
      if (pass !== '3469' && pass !== '1234') {
        modal.querySelector('#msgPasswordErrorEdicion').style.display = 'block';
        return; // Detener aquí, no llamar onConfirm
      }
      accionRealizada = true;
      modal.style.display = 'none';
      cleanup();
      onConfirm(pass);
    };
    modal.querySelector('#btnCancelarEdicion').onclick = function() {
      if (accionRealizada) return;
      accionRealizada = true;
      modal.style.display = 'none';
      cleanup();
      // No llamar onConfirm, solo cerrar y detener
    };
  }



  // --- REGISTRO DE MOVIMIENTOS DE INVENTARIO ---
  // === GUARDADO ATÓMICO: pedido + movimientos en una sola operación ===
  // Antes el pedido se escribía primero (status DESPACHADO/ENTREGADO) y los movimientos
  // se escribían después, uno por uno, en escrituras separadas. Si el contexto se
  // interrumpía entre medio (cierre/recarga de ventana, navegación, suspensión, corte de
  // red) quedaba el pedido guardado SIN movimientos, de forma aleatoria y sin aviso.
  // Firebase garantiza que un update multi-ruta es atómico: todas las rutas se confirman
  // en el servidor, o ninguna. Así el pedido y sus movimientos se graban juntos (todo o nada).
  async function guardarPedidoConMovimientos(pedidoId, pedidoObj, items) {
    console.log('===== INICIO guardarPedidoConMovimientos =====');
    console.log('PedidoId:', pedidoId, '| Items a procesar:', Array.isArray(items) ? items.length : 'N/A');

    if (!pedidoId || !pedidoObj || !Array.isArray(items)) {
      throw new Error('Parámetros inválidos en guardarPedidoConMovimientos');
    }

    const errores = [];
    const rootUpdates = {};

    // 1. Marcar para eliminación los movimientos previos de este pedido (caso edición).
    const snapshot = await db.ref('movimientos').orderByChild('pedidoId').equalTo(pedidoId).once('value');
    snapshot.forEach(child => { rootUpdates['movimientos/' + child.key] = null; });

    // 1b. Al reeditar un pedido de cambio hay que soltar las retro-referencias que había
    //     dejado en los pedidos de origen; abajo se vuelven a escribir las que correspondan.
    //     Solo aplica en ediciones: un alta recién push()eada todavía no tiene nodo.
    if (Object.keys(rootUpdates).length > 0) {
      const previo = await db.ref('pedidos/' + pedidoId).once('value');
      const datosPrevios = previo.val() || {};
      const itemsPrevios = datosPrevios.items || [];
      [...new Set(itemsPrevios.map(it => it && it.pedidoOrigenId).filter(Boolean))]
        .filter(origenId => origenId !== pedidoId)
        .forEach(origenId => { rootUpdates[`pedidos/${origenId}/devoluciones/${pedidoId}`] = null; });
      // El commit reescribe el nodo completo del pedido: sin esto se perderían las
      // devoluciones que OTROS pedidos hayan registrado contra éste.
      if (datosPrevios.devoluciones && !pedidoObj.devoluciones) {
        pedidoObj.devoluciones = datosPrevios.devoluciones;
      }
    }

    // 2. Construir los nuevos movimientos (mismas validaciones, id y campos que antes).
    let exitosos = 0;
    const devolucionesPorOrigen = {};
    for (const item of items) {
      // valorU === 0 es válido: es el caso de una reposición por garantía, que no se cobra
      // pero SÍ tiene que descontar la unidad de reemplazo del stock.
      if (!item || !item.codigo || !item.nombre || !item.cantidad ||
          item.valorU == null || item.valorU < 0) {
        console.warn('⚠️ Item inválido, saltando:', item);
        errores.push(`Item inválido: ${item?.nombre || 'sin nombre'}`);
        continue;
      }

      // DEVOLUCION reingresa la unidad al depósito; VENTA y GARANTIA la sacan.
      const tipoMov = item.tipoLinea === 'DEVOLUCION' ? 'ENTRADA' : 'SALIDA';

      const now = new Date();
      const pad = n => n.toString().padStart(2, '0');
      // El sufijo E/S evita que la entrada y la salida del MISMO artículo (un cambio de
      // un artículo por sí mismo) colisionen en el mismo id dentro del mismo segundo.
      let id = `mov_${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}_${item.codigo}_${tipoMov === 'ENTRADA' ? 'E' : 'S'}_${pedidoId}`;
      // Evitar que dos movimientos con mismo id (mismo codigo/segundo) se pisen dentro del mismo update.
      let movPath = 'movimientos/' + id;
      if (rootUpdates[movPath]) movPath = 'movimientos/' + id + '_' + exitosos;

      rootUpdates[movPath] = {
        timestamp: Date.now(),
        codigo: item.codigo,
        nombre: item.nombre,
        cantidad: parseInt(item.cantidad, 10) || 0,
        tipo: tipoMov,
        pedidoId: pedidoId,
        // Campos aditivos: los consumidores existentes solo leen tipo/cantidad/codigo.
        ...(esLineaCambio(item) ? {
          motivo: item.tipoLinea,
          pedidoOrigenId: item.pedidoOrigenId || ''
        } : {})
      };
      exitosos++;

      // Se descarta el auto-origen (editar un cambio y elegirse a sí mismo como pedido
      // original): Firebase rechaza un update donde una ruta es ancestro de otra, y
      // 'pedidos/X' junto a 'pedidos/X/devoluciones/X' lo sería.
      if (esLineaCambio(item) && item.pedidoOrigenId && item.pedidoOrigenId !== pedidoId) {
        (devolucionesPorOrigen[item.pedidoOrigenId] ||= []).push({
          codigo: item.codigo,
          nombre: item.nombre,
          cantidad: parseInt(item.cantidad, 10) || 0,
          tipoLinea: item.tipoLinea
        });
      }
    }

    if (exitosos === 0) {
      throw new Error('No se generaron movimientos válidos para el pedido.');
    }

    // 3. Incluir el pedido en la MISMA operación (sobrescribe el nodo = equivale a .set()).
    rootUpdates['pedidos/' + pedidoId] = pedidoObj;

    // 3b. Retro-referencia en cada pedido de origen. Es una escritura de hijo (no pisa el
    //     nodo del pedido original) y permite avisar en el panel qué unidades ya se
    //     devolvieron, para no reintegrar dos veces el mismo artículo.
    Object.keys(devolucionesPorOrigen).forEach(origenId => {
      rootUpdates[`pedidos/${origenId}/devoluciones/${pedidoId}`] = {
        fecha: pedidoObj.fecha || '',
        lineas: devolucionesPorOrigen[origenId]
      };
    });

    // 4. Commit atómico: pedido + movimientos juntos (todo o nada).
    console.log(`📝 Commit atómico: pedido + ${exitosos} movimientos...`);
    await db.ref().update(rootUpdates);

    // 5. Verificación defensiva: confirmar que los movimientos quedaron registrados.
    const verif = await db.ref('movimientos').orderByChild('pedidoId').equalTo(pedidoId).once('value');
    let verifCount = 0;
    verif.forEach(() => { verifCount++; });
    if (verifCount < exitosos) {
      throw new Error(`Movimientos incompletos (${verifCount}/${exitosos}).`);
    }
    console.log(`✅ Confirmados ${verifCount} movimientos para el pedido ${pedidoId}`);

    // 6. Aviso de artículos omitidos (no aborta: el pedido y sus movimientos válidos ya quedaron).
    if (errores.length > 0) {
      console.warn('⚠️ Artículos omitidos en movimientos:', errores);
      const msg = errores.length === 1
        ? '⚠️ 1 artículo no generó movimiento de inventario (datos incompletos).'
        : `⚠️ ${errores.length} artículos no generaron movimiento de inventario (datos incompletos).`;
      showPopup(msg + '\nRevise la consola para más detalles.', '⚠️', true);
    }

    console.log('===== FIN guardarPedidoConMovimientos =====');
    return { exitosos, errores };
  }

  // === FUNCIÓN PARA RESTABLECER FORMULARIO (BOTÓN NUEVO) ===
  function restablecerFormulario() {
    // Confirmar con el usuario si hay datos
    const nombreActual = form.nombre.value.trim().toLowerCase();
    const hayDatos = items.length > 0 ||
                     (nombreActual !== '' && nombreActual !== 'n/a') ||
                     form.telefono.value.trim() !== '' ||
                     form.direccion.value.trim() !== '';
    
    if (hayDatos) {
      const confirmar = confirm('¿Está seguro de que desea crear un nuevo pedido? Se perderán los datos actuales.');
      if (!confirmar) return;
    }
    
    // Limpiar campos del formulario
    form.nombre.value = '';
    form.telefono.value = '';
    form.direccion.value = '';
    form.dni.value = '';
    form.email.value = '';
    form.medioPago.value = '';
    form.recargo.value = '';
    form.recargoPorcentaje.value = '';
    form.descuento.value = '';
    form.descuentoPorcentaje.value = '';
    form.envio.value = '';
    form.subtotal.value = '';
    form.totalFinal.value = '';
    
    if (form.nota) form.nota.value = '';
    if (form.vendedor) form.vendedor.value = '';
    if (form.alias) form.alias.value = '';
    
    // Restablecer tipo de cliente a "mayorista" por defecto
    const radioConsumidorFinal = document.querySelector('input[name="tipoCliente"][value="mayorista"]');
    if (radioConsumidorFinal) {
      radioConsumidorFinal.checked = true;
      tipoCliente = 'mayorista';
    }
    
    // Limpiar array de items
    items = [];
    limpiarEstadoCambios();
    renderItems();

    // Limpiar buscador de artículos
    if (searchInput) searchInput.value = '';
    if (searchQuantity) searchQuantity.value = '1';
    if (searchResults) { searchResults.innerHTML = ''; searchResults.style.display = 'none'; }
    selectedResultIndex = -1;
    selectedArticuloNombre = null;
    ocultarNoEncontrado();
    
    // Limpiar URL para quitar parámetro ?id= si existe
    const newUrl = window.location.pathname;
    window.history.replaceState({}, document.title, newUrl);
    
    // Enfocar en el campo de búsqueda de artículos
    if (searchInput) {
      setTimeout(() => searchInput.focus(), 100);
    }
    
    if (window.desactivarModoAdmin) window.desactivarModoAdmin();
    if (window.contraerExtraCliente) window.contraerExtraCliente();

    // El modo Whatsapp sobrevive al restablecimiento: reponer vendedor y búsqueda manual
    if (busquedaManualPersistente) {
      if (form.vendedor) {
        asegurarOpcionVendedor('WhatsApp');
        form.vendedor.value = 'WhatsApp';
      }
      if (!busquedaManualHabilitada && typeof activarBusquedaManual === 'function') {
        activarBusquedaManual();
      }
    }

    console.log('✅ Formulario restablecido correctamente');
  }

  // === MANEJADOR DEL BOTÓN NUEVO ===
  const btnNuevo = document.getElementById('nuevoBtn');
  if (btnNuevo) {
    btnNuevo.addEventListener('click', function(e) {
      e.preventDefault();
      restablecerFormulario();
    });
  }

  // === MODAL CONTRASEÑA ADMIN / WHATSAPP ===
  // Un mismo modal (#adminPassOverlay) atiende ambos accesos; `modoPass` decide
  // qué contraseña se valida y qué se activa al confirmar.
  (function() {
    const ADMIN_PASS    = '47623212';
    const WHATSAPP_PASS = '2381';
    const overlay = document.getElementById('adminPassOverlay');
    const input   = document.getElementById('adminPassInput');
    const errDiv  = document.getElementById('adminPassError');
    const titulo  = document.getElementById('adminPassTitle');
    const btnConf = document.getElementById('adminPassConfirmBtn');
    const btnCanc = document.getElementById('adminPassCancelBtn');
    const adminBtn = document.getElementById('adminModeBtn');
    const whatsappBtn = document.getElementById('whatsappModeBtn');

    let modoPass = 'admin';

    function abrirModal(modo) {
      modoPass = modo || 'admin';
      if (titulo) {
        titulo.textContent = modoPass === 'whatsapp' ? 'Modo WhatsApp' : 'Acceso Administrador';
      }
      input.value = '';
      errDiv.style.display = 'none';
      overlay.style.display = 'flex';
      setTimeout(() => input.focus(), 80);
    }

    function cerrarModal() {
      overlay.style.display = 'none';
    }

    function activarModoAdmin() {
      mostrarClientesAdmin = true;
      cargarClientes();
      if (form.nombre.value.trim() === 'n/a') form.nombre.value = '';
      adminBtn.style.background = '#6c4eb6';
      adminBtn.style.color = '#fff';
    }

    // persistir=false se usa al restaurar el modo desde sessionStorage tras una recarga
    function activarModoWhatsapp(persistir) {
      busquedaManualPersistente = true;
      if (typeof activarBusquedaManual === 'function') activarBusquedaManual();
      if (whatsappBtn) {
        whatsappBtn.style.background = '#25D366';
        whatsappBtn.style.color = '#fff';
        whatsappBtn.title = 'Desactivar modo WhatsApp';
      }
      if (persistir !== false) {
        try { sessionStorage.setItem(WHATSAPP_MODE_KEY, '1'); } catch (e) {}
      }
      // Preseleccionar el vendedor sólo si está vacío y no se está editando un pedido
      if (!pedidoId && form.vendedor && !form.vendedor.value) {
        asegurarOpcionVendedor('WhatsApp');
        form.vendedor.value = 'WhatsApp';
      }
    }

    function desactivarModoWhatsapp() {
      busquedaManualPersistente = false;
      if (busquedaManualHabilitada && typeof desactivarBusquedaManual === 'function') {
        desactivarBusquedaManual();
      }
      if (whatsappBtn) {
        whatsappBtn.style.background = '';
        whatsappBtn.style.color = '';
        whatsappBtn.title = '';
      }
      try { sessionStorage.removeItem(WHATSAPP_MODE_KEY); } catch (e) {}
    }

    function confirmar() {
      const passEsperada = modoPass === 'whatsapp' ? WHATSAPP_PASS : ADMIN_PASS;
      if (input.value === passEsperada) {
        if (modoPass === 'whatsapp') activarModoWhatsapp(true);
        else activarModoAdmin();
        cerrarModal();
      } else {
        errDiv.style.display = 'block';
        input.value = '';
        input.focus();
      }
    }

    window.desactivarModoAdmin = function() {
      if (!mostrarClientesAdmin) return;
      mostrarClientesAdmin = false;
      cargarClientes();
      adminBtn.style.background = '';
      adminBtn.style.color = '';
    };

    // Expuesto para restaurar el modo tras una recarga (ver bloque al final del archivo)
    window.restaurarModoWhatsapp = function() {
      let guardado = null;
      try { guardado = sessionStorage.getItem(WHATSAPP_MODE_KEY); } catch (e) {}
      if (guardado === '1') activarModoWhatsapp(false);
    };

    adminBtn.addEventListener('click', function() { abrirModal('admin'); });

    if (whatsappBtn) {
      whatsappBtn.addEventListener('click', function() {
        // Toggle: si el modo ya está activo se apaga sin pedir contraseña
        if (busquedaManualPersistente) desactivarModoWhatsapp();
        else abrirModal('whatsapp');
      });
    }

    btnConf.addEventListener('click', confirmar);
    btnCanc.addEventListener('click', cerrarModal);

    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) cerrarModal();
    });

    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') { e.preventDefault(); confirmar(); }
      else if (e.key === 'Escape') cerrarModal();
    });
  })();

  // === MODAL CONTRASEÑA BÚSQUEDA MANUAL ===
  (function() {
    const MANUAL_PASS = 'homepoint2278';
    const overlay = document.getElementById('manualPassOverlay');
    const input   = document.getElementById('manualPassInput');
    const errDiv  = document.getElementById('manualPassError');
    const btnConf = document.getElementById('manualPassConfirmBtn');
    const btnCanc = document.getElementById('manualPassCancelBtn');
    const manualBtn   = document.getElementById('manualSearchBtn');
    const manualIcon  = document.getElementById('manualSearchIcon');
    const manualLabel = document.getElementById('manualSearchLabel');
    const helpText    = document.getElementById('searchHelpText');
    if (!overlay || !manualBtn) return;

    const PLACEHOLDER_BARCODE = 'Escanee o ingrese el código de barras...';
    const PLACEHOLDER_MANUAL  = 'Buscar por nombre o código...';
    const HELP_BARCODE = '💡 Dispare el lector: el artículo se agrega solo. Escanee otra vez para sumar una unidad, o cargue la cantidad antes de escanear.';
    const HELP_MANUAL  = '🔓 <strong>Búsqueda manual activa:</strong> busque por nombre, elija con ↑ ↓ y confirme con Enter.';

    function abrirModal() {
      input.value = '';
      errDiv.style.display = 'none';
      overlay.style.display = 'flex';
      setTimeout(() => input.focus(), 80);
    }

    function cerrarModal() {
      overlay.style.display = 'none';
    }

    function activarModoManual() {
      busquedaManualHabilitada = true;
      manualBtn.style.background = '#28a745';
      manualBtn.style.color = '#fff';
      manualBtn.style.borderColor = '#28a745';
      manualBtn.title = 'Desactivar búsqueda manual';
      if (manualIcon)  manualIcon.textContent = '🔓';
      if (manualLabel) manualLabel.textContent = 'Modo manual';
      if (searchInput) searchInput.placeholder = PLACEHOLDER_MANUAL;
      if (helpText)    helpText.innerHTML = HELP_MANUAL;
    }

    function desactivarModoManual() {
      busquedaManualHabilitada = false;
      manualBtn.style.background = '#fff';
      manualBtn.style.color = '#6c4eb6';
      manualBtn.style.borderColor = '#6c4eb6';
      manualBtn.title = 'Habilitar búsqueda manual por nombre';
      if (manualIcon)  manualIcon.textContent = '🔒';
      if (manualLabel) manualLabel.textContent = 'Búsqueda Manual';
      if (searchInput) searchInput.placeholder = PLACEHOLDER_BARCODE;
      if (helpText)    helpText.innerHTML = HELP_BARCODE;
    }

    // Exponer al scope exterior para desactivar el modo manual tras agregar un artículo
    desactivarBusquedaManual = desactivarModoManual;
    // Exponer el activador para el modo Whatsapp (búsqueda manual indefinida)
    activarBusquedaManual = activarModoManual;

    function confirmar() {
      if (input.value === MANUAL_PASS) {
        activarModoManual();
        cerrarModal();
      } else {
        errDiv.style.display = 'block';
        input.value = '';
        input.focus();
      }
    }

    manualBtn.addEventListener('click', function() {
      // Toggle: si ya está activo, se desactiva sin pedir contraseña
      if (busquedaManualHabilitada) {
        desactivarModoManual();
      } else if (busquedaManualPersistente) {
        // En modo Whatsapp el usuario ya se autenticó: puede reactivarla libremente
        activarModoManual();
      } else {
        abrirModal();
      }
    });

    // Estado inicial: modo código de barras. Deja pintado el texto de ayuda, que
    // antes nunca aparecía porque #searchHelpText no existía en el markup.
    desactivarModoManual();

    btnConf.addEventListener('click', confirmar);
    btnCanc.addEventListener('click', cerrarModal);

    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) cerrarModal();
    });

    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') { e.preventDefault(); confirmar(); }
      else if (e.key === 'Escape') cerrarModal();
    });
  })();

  // === PANEL DE CAMBIOS Y DEVOLUCIONES ===
  // Localiza el pedido original a partir del número impreso en el ticket y permite armar,
  // sobre la misma orden, las líneas de devolución (ENTRADA) y de garantía (SALIDA sin cargo).
  (function() {
    const panel        = document.getElementById('cambiosPanel');
    const btnModo      = document.getElementById('cambiosModeBtn');
    const btnCerrar    = document.getElementById('cambiosCerrarBtn');
    const input        = document.getElementById('cambiosBuscarInput');
    const contResult   = document.getElementById('cambiosResultados');
    const contOrigen   = document.getElementById('cambiosOrigen');
    const btnAmpliar   = document.getElementById('cambiosAmpliarBtn');
    const chipVentana  = document.getElementById('cambiosVentana');
    if (!panel || !btnModo || !input) return;

    const DIAS_VENTANA = 15;
    const MAX_RESULTADOS = 25;
    // Una push key de Firebase tiene 20 caracteres: a partir de ese largo el término
    // tipeado ya no es un fragmento del ticket sino el id completo.
    const LARGO_ID_COMPLETO = 15;

    // Caché de la ventana descargada. `completa` marca que se trajo todo el historial.
    let cache = { datos: null, completa: false };
    // Descargas en vuelo por alcance, para no repetir la misma consulta en paralelo.
    const enVuelo = { ventana: null, completa: null };
    let debounce = null;
    let idxTeclado = -1;
    let resultadosActuales = [];
    let cargando = false;

    // --- Descarga de pedidos -------------------------------------------------

    function fechaLimite(dias) {
      // Igual que historialRecientes.html: se trabaja sobre la hora de Argentina (UTC-3)
      const ahora = new Date();
      const arg = new Date(ahora.getTime() - (3 * 60 * 60 * 1000) - (dias * 24 * 60 * 60 * 1000));
      return arg.toISOString().split('T')[0];
    }

    function descargar(completa) {
      let ref = db.ref('pedidos');
      // orderByChild('fecha') con startAt limita la descarga en el servidor
      // (mismo índice que ya usan historialRecientes.html e historialTotal.html).
      if (!completa) ref = ref.orderByChild('fecha').startAt(fechaLimite(DIAS_VENTANA));
      else ref = ref.orderByChild('fecha');

      return ref.once('value').then(snap => {
        const datos = {};
        snap.forEach(child => { datos[child.key] = child.val(); });
        // Si mientras viajaba esta ventana llegó el historial completo, no se degrada:
        // la caché completa es un superconjunto de la de 15 días.
        if (completa || !cache.completa) {
          cache = { datos, completa: !!completa };
          if (chipVentana) chipVentana.textContent = completa ? 'Historial completo' : `Últimos ${DIAS_VENTANA} días`;
        }
        return cache.datos;
      });
    }

    function asegurarCache(completa) {
      if (cache.datos && (cache.completa || !completa)) return Promise.resolve(cache.datos);

      const alcance = completa ? 'completa' : 'ventana';
      // Sin esto, seguir tecleando mientras la descarga viaja dispara una segunda descarga
      // idéntica: se reutiliza la petición en curso. Una descarga completa en vuelo
      // también sirve para satisfacer un pedido de la ventana de 15 días.
      const enCurso = enVuelo[alcance] || enVuelo.completa;
      if (enCurso) return enCurso;

      const promesa = descargar(completa).finally(() => { enVuelo[alcance] = null; });
      enVuelo[alcance] = promesa;
      return promesa;
    }

    // --- Búsqueda ------------------------------------------------------------

    function coincide(id, pedido, termino) {
      // El ticket imprime los últimos 8 caracteres EN MAYÚSCULA, pero las push keys de
      // Firebase distinguen mayúsculas de minúsculas: la comparación va normalizada.
      if (String(id).toUpperCase().includes(termino)) return true;
      const c = pedido.cliente || {};
      return [c.nombre, c.telefono, c.dni]
        .some(v => v && String(v).toUpperCase().includes(termino));
    }

    async function buscar(termino, completa) {
      const term = String(termino || '').trim().toUpperCase();
      if (term.length < 3) { ocultarResultados(); return; }

      ultimoTerminoBuscado = termino.trim();
      cargando = true;
      renderCargando();

      try {
        // Vía rápida: el término ya es un id completo, se lee el nodo directo.
        if (term.length >= LARGO_ID_COMPLETO) {
          const directo = await db.ref('pedidos/' + termino.trim()).once('value');
          if (directo.exists()) {
            renderResultados([{ id: termino.trim(), pedido: directo.val() }]);
            return;
          }
        }

        const datos = await asegurarCache(completa);
        const hallados = Object.keys(datos)
          .filter(id => datos[id] && coincide(id, datos[id], term))
          .map(id => ({ id, pedido: datos[id] }))
          .sort((a, b) => String(b.pedido.fecha || '').localeCompare(String(a.pedido.fecha || '')))
          .slice(0, MAX_RESULTADOS);

        renderResultados(hallados);
      } catch (err) {
        console.error('Error buscando el pedido original:', err);
        contResult.innerHTML = '<div class="cambios-vacio">No se pudo consultar el historial. Reintentá en unos segundos.</div>';
        contResult.classList.add('visible');
      } finally {
        cargando = false;
      }
    }

    function renderCargando() {
      contResult.innerHTML = '<div class="cambios-vacio">Buscando…</div>';
      contResult.classList.add('visible');
    }

    function ocultarResultados() {
      contResult.classList.remove('visible');
      contResult.innerHTML = '';
      resultadosActuales = [];
      idxTeclado = -1;
    }

    function renderResultados(lista) {
      resultadosActuales = lista;
      idxTeclado = -1;

      if (lista.length === 0) {
        contResult.innerHTML = `<div class="cambios-vacio">Sin coincidencias${cache.completa ? '' : ' en los últimos ' + DIAS_VENTANA + ' días'}.<br>Probá con el número completo del ticket o ampliá la búsqueda.</div>`;
        contResult.classList.add('visible');
        return;
      }

      contResult.innerHTML = lista.map((r, i) => {
        const p = r.pedido || {};
        const cant = (p.items || []).length;
        const total = parseImporte(p.pagos && p.pagos.totalFinal);
        return `
          <div class="cambios-result-item" data-idx="${i}" role="option">
            <div class="cambios-result-top">
              <span class="cambios-result-id">${idCortoPedido(r.id)}</span>
              <span class="cambios-result-total">${formatoPesos(total)}</span>
            </div>
            <div class="cambios-result-meta">
              ${p.fecha || 'sin fecha'} · ${(p.cliente && p.cliente.nombre) || 'sin nombre'}
              · ${cant} ${cant === 1 ? 'artículo' : 'artículos'}
              ${p.status === 'CANCELADO' ? ' · <strong>CANCELADO</strong>' : ''}
            </div>
          </div>`;
      }).join('');
      contResult.classList.add('visible');
    }

    function marcarSeleccionTeclado() {
      const nodos = contResult.querySelectorAll('.cambios-result-item');
      nodos.forEach((n, i) => n.classList.toggle('keyboard-selected', i === idxTeclado));
      if (idxTeclado >= 0 && nodos[idxTeclado]) {
        nodos[idxTeclado].scrollIntoView({ block: 'nearest' });
      }
    }

    // --- Tarjeta del pedido de origen ---------------------------------------

    // Unidades ya devueltas por artículo, leídas de las retro-referencias que dejan los
    // pedidos de cambio anteriores contra este mismo pedido.
    function devueltasPorCodigo(pedido) {
      const acumulado = {};
      const devs = pedido.devoluciones || {};
      Object.keys(devs).forEach(k => {
        ((devs[k] && devs[k].lineas) || []).forEach(l => {
          if (!l || !l.codigo) return;
          acumulado[l.codigo] = (acumulado[l.codigo] || 0) + (parseInt(l.cantidad, 10) || 0);
        });
      });
      return acumulado;
    }

    // === CUPO DISPONIBLE POR LINEA DEL PEDIDO ORIGINAL ===
    // No se puede devolver ni reemplazar mas unidades de las que el cliente
    // compro. El cupo es: comprado - ya procesado en cambios anteriores (nodo
    // devoluciones/) - lo que ya esta cargado en ESTA operacion.
    function mismaLinea(itOrigen, linea) {
      return itOrigen.codigo ? linea.codigo === itOrigen.codigo : linea.nombre === itOrigen.nombre;
    }

    function unidadesEnOperacion(pedidoId, itOrigen) {
      return items.reduce((acc, ln) => {
        if (!esLineaCambio(ln) || ln.pedidoOrigenId !== pedidoId) return acc;
        return mismaLinea(itOrigen, ln) ? acc + (parseInt(ln.cantidad, 10) || 0) : acc;
      }, 0);
    }

    // Devolucion y garantia comparten cupo: una unidad comprada se procesa una sola vez.
    function cupoLinea(idxItem) {
      const pedido = pedidoOrigenSeleccionado;
      const it = pedido && (pedido.items || [])[idxItem];
      if (!it) return null;
      const comprado = parseInt(it.cantidad, 10) || 0;
      const previas  = devueltasPorCodigo(pedido)[it.codigo] || 0;
      const enCurso  = unidadesEnOperacion(pedido.id, it);
      return {
        it, comprado, previas, enCurso,
        // Techo total admisible para esta linea dentro de la operacion actual.
        maximo: Math.max(0, comprado - previas),
        restante: Math.max(0, comprado - previas - enCurso)
      };
    }

    // Mantiene el panel del pedido original en sincronia con lo ya cargado:
    // ajusta el max de cada input, apaga los botones sin cupo y explica por que.
    function refrescarCupos() {
      if (!pedidoOrigenSeleccionado || contOrigen.hidden) return;
      contOrigen.querySelectorAll('.cambios-origen-item').forEach(fila => {
        const cupo = cupoLinea(parseInt(fila.getAttribute('data-item'), 10));
        if (!cupo) return;
        const agotada = cupo.restante <= 0;

        fila.classList.toggle('cambios-origen-agotada', agotada);
        fila.querySelectorAll('[data-accion]').forEach(b => { b.disabled = agotada; });

        const input = fila.querySelector('.cambios-cant-input');
        if (input) {
          input.max = Math.max(1, cupo.restante);
          input.disabled = agotada;
          const val = parseInt(input.value, 10) || 1;
          input.value = agotada ? '0' : String(Math.min(Math.max(1, val), cupo.restante));
        }

        const aviso = fila.querySelector('.cambios-origen-aviso');
        if (!aviso) return;
        const usadas = cupo.previas + cupo.enCurso;
        if (usadas <= 0) { aviso.hidden = true; aviso.textContent = ''; return; }
        aviso.hidden = false;
        aviso.textContent = agotada
          ? 'Sin unidades disponibles: ' + cupo.comprado + ' de ' + cupo.comprado + ' ya procesadas'
          : usadas + ' de ' + cupo.comprado + ' ya procesadas \u00b7 quedan ' + cupo.restante;
      });
    }
    // Lo usan agregarLineaCambio, la edicion de cantidad y removeItem.
    refrescarCuposCambio = refrescarCupos;

    function seleccionarPedido(id, pedido) {
      pedidoOrigenSeleccionado = { id, ...pedido };
      ocultarResultados();
      input.value = idCortoPedido(id);
      renderOrigen(id, pedido);
    }

    function renderOrigen(id, pedido) {
      const yaDevueltas = devueltasPorCodigo(pedido);
      const total = parseImporte(pedido.pagos && pedido.pagos.totalFinal);
      // El descuento del pedido original se prorratea sobre sus líneas: lo que se devuelve
      // es lo que el cliente pagó, no el precio de lista con el que se cargó la venta.
      const factor = factorDescuentoOrigen(pedido);
      const huboDescuento = factor < 1;
      // Un descuento por monto fijo rara vez cae en un porcentaje redondo: se muestra con
      // un decimal cuando lo tiene, para que el número no contradiga al ticket.
      const pct = (1 - factor) * 100;
      const pctDescuento = (Math.round(pct * 10) / 10).toLocaleString('es-AR');

      const filas = (pedido.items || []).map((it, i) => {
        const imgs = obtenerImagenesArticulo(it.nombre);
        const devueltas = yaDevueltas[it.codigo] || 0;
        const disponibles = Math.max(0, (parseInt(it.cantidad, 10) || 0) - devueltas);
        // El texto lo escribe refrescarCupos(): el nodo se renderiza siempre para
        // poder actualizarlo sin rehacer el HTML del panel entero.
        const aviso = '<div class="cambios-origen-aviso" hidden></div>';
        const img = imgs.principal
          ? `<img src="${imgs.principal}" class="cambios-origen-img" alt="" ${imgFallbackAttrs(imgs.alt)}>`
          : '<div class="cambios-origen-img"></div>';

        return `
          <div class="cambios-origen-item" data-item="${i}">
            ${img}
            <div class="cambios-origen-info">
              <div class="cambios-origen-nombre">${it.nombre || ''}</div>
              <div class="cambios-origen-cod">COD.${it.codigo || '—'} · compró ${it.cantidad}</div>
              ${aviso}
            </div>
            <div class="cambios-origen-precio">
              <span class="cambios-origen-precio-label">Pagó</span>
              <span class="cambios-origen-precio-valor">${formatoPesos(Math.round(parseImporte(it.valorU) * factor))}</span>
              ${huboDescuento ? `<span class="cambios-origen-precio-lista"><s>${formatoPesos(parseImporte(it.valorU))}</s> · −${pctDescuento}%</span>` : ''}
            </div>
            <div class="cambios-origen-acciones">
              <input type="number" class="cambios-cant-input" value="1" min="1" max="${Math.max(1, disponibles)}"
                     aria-label="Cantidad a procesar de ${it.nombre || ''}">
              <button type="button" class="cambios-btn-devolver" data-accion="DEVOLUCION" data-item="${i}"
                      title="Devolución: el artículo vuelve al stock y se descuenta lo que el cliente pagó">↩ Devolución</button>
              <button type="button" class="cambios-btn-falla" data-accion="GARANTIA" data-item="${i}"
                      title="Reemplazo por falla: sale una unidad nueva del stock, sin cargo">⚠ Reemplazar</button>
            </div>
          </div>`;
      }).join('');

      contOrigen.innerHTML = `
        <div class="cambios-origen-head">
          <div>
            <span class="cambios-origen-id">${idCortoPedido(id)}</span>
            <div class="cambios-origen-meta">${pedido.fecha || 'sin fecha'} · ${(pedido.cliente && pedido.cliente.nombre) || 'sin nombre'} · ${(pedido.pagos && pedido.pagos.medioPago) || '—'}</div>
          </div>
          <span class="cambios-origen-total">${formatoPesos(total)}</span>
        </div>
        ${huboDescuento ? `<div class="cambios-origen-descuento-aviso">
          <span aria-hidden="true">ⓘ</span> Este pedido se cobró con un descuento de
          ${formatoPesos(parseImporte(pedido.pagos && pedido.pagos.descuento))} (−${pctDescuento}%):
          las devoluciones se calculan sobre lo que el cliente pagó, no sobre el precio de lista.
        </div>` : ''}
        ${filas || '<div class="cambios-vacio">Este pedido no tiene artículos cargados.</div>'}
      `;
      contOrigen.hidden = false;
      // Estado inicial de cupos: contempla tanto los cambios previos como las
      // lineas que ya esten cargadas de este mismo pedido en la operacion actual.
      refrescarCupos();

      // Traer los datos del cliente del pedido original evita retipearlos y mantiene la
      // trazabilidad entre la venta y su cambio.
      if (pedido.cliente && !form.nombre.value.trim()) {
        form.nombre.value = pedido.cliente.nombre || '';
        form.telefono.value = pedido.cliente.telefono || '';
        form.direccion.value = pedido.cliente.direccion || '';
      }
    }

    function procesarAccion(accion, idxItem, cantidad, cupo) {
      if (!pedidoOrigenSeleccionado) return;
      const it = (pedidoOrigenSeleccionado.items || [])[idxItem];
      if (!it) return;
      // Recalcular el cupo si no vino dado (Enter en el input, llamadas internas).
      const cupoLin = cupo || cupoLinea(idxItem);
      if (!cupoLin || cupoLin.restante <= 0) { refrescarCupos(); return; }
      const cant = Math.min(Math.max(1, parseInt(cantidad, 10) || 1), cupoLin.restante);

      // Lo que se devuelve es lo que el cliente pagó: el descuento del pedido original,
      // guardado como monto global, se prorratea sobre el precio de lista de la línea.
      // La garantía queda al valor de lista: es una reposición sin cargo y su valorU no
      // mueve importes, sólo deja registrado a cuánto se había vendido la unidad.
      const valorLista = parseImporte(it.valorU);
      const factor = factorDescuentoOrigen(pedidoOrigenSeleccionado);
      const valorPagado = accion === 'DEVOLUCION' ? Math.round(valorLista * factor) : valorLista;

      agregarLineaCambio({
        tipoLinea: accion,
        nombre: it.nombre,
        codigo: it.codigo,
        codigoBarras: it.codigoBarras,
        cantidad: cant,
        cupoMaximo: cupoLin.maximo,
        valorU: valorPagado,
        valorULista: valorLista,
        valorC: parseImporte(it.valorC),
        categoria: it.categoria,
        seleccionado: it.seleccionado,
        pedidoOrigenId: pedidoOrigenSeleccionado.id,
        motivo: accion === 'GARANTIA' ? 'Falla' : 'Devolución'
      });

      // agregarLineaCambio ya dispara refrescarCupos(); esto solo cubre el caso
      // en que la linea no se haya podido crear.
      refrescarCupos();

      // Tras registrar la devolución, el foco vuelve al escáner para cargar el reemplazo.
      if (searchInput) searchInput.focus();
    }

    // --- Apertura / cierre ---------------------------------------------------

    function abrir() {
      panel.hidden = false;
      btnModo.style.background = '#d97706';
      btnModo.style.color = '#fff';
      setTimeout(() => input.focus(), 60);
    }

    function cerrar() {
      if (panel.hidden) return;
      panel.hidden = true;
      btnModo.style.background = '';
      btnModo.style.color = '';
      ocultarResultados();
      if (searchInput) searchInput.focus();
    }

    function alternar() {
      if (panel.hidden) abrir();
      else cerrar();
    }

    abrirPanelCambios = abrir;
    cerrarPanelCambios = cerrar;

    // --- Eventos -------------------------------------------------------------

    btnModo.addEventListener('click', alternar);
    if (btnCerrar) btnCerrar.addEventListener('click', cerrar);

    input.addEventListener('input', function() {
      clearTimeout(debounce);
      const valor = this.value;
      debounce = setTimeout(() => buscar(valor, cache.completa), 250);
    });

    input.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') { e.preventDefault(); ocultarResultados(); return; }
      if (!resultadosActuales.length) {
        if (e.key === 'Enter') { e.preventDefault(); clearTimeout(debounce); buscar(this.value, cache.completa); }
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        idxTeclado = Math.min(idxTeclado + 1, resultadosActuales.length - 1);
        marcarSeleccionTeclado();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        idxTeclado = Math.max(idxTeclado - 1, 0);
        marcarSeleccionTeclado();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const elegido = resultadosActuales[idxTeclado >= 0 ? idxTeclado : 0];
        if (elegido) seleccionarPedido(elegido.id, elegido.pedido);
      }
    });

    contResult.addEventListener('click', function(e) {
      const fila = e.target.closest('.cambios-result-item');
      if (!fila) return;
      const r = resultadosActuales[parseInt(fila.getAttribute('data-idx'), 10)];
      if (r) seleccionarPedido(r.id, r.pedido);
    });

    if (btnAmpliar) {
      btnAmpliar.addEventListener('click', async function() {
        if (cargando) return;
        this.disabled = true;
        this.textContent = 'Descargando historial…';
        try {
          await asegurarCache(true);
          await buscar(input.value, true);
        } catch (err) {
          // Sin este catch la promesa del handler quedaba rechazada sin capturar y el
          // operador no veía nada: el botón volvía a su estado como si hubiera funcionado.
          console.error('Error descargando el historial completo:', err);
          contResult.innerHTML = '<div class="cambios-vacio">No se pudo descargar el historial. Reintentá en unos segundos.</div>';
          contResult.classList.add('visible');
        } finally {
          this.disabled = false;
          this.textContent = 'Buscar en todo el historial';
        }
      });
    }

    contOrigen.addEventListener('click', function(e) {
      const btn = e.target.closest('[data-accion]');
      if (!btn || btn.disabled) return;
      const idxItem = parseInt(btn.getAttribute('data-item'), 10);
      const cupo = cupoLinea(idxItem);
      if (!cupo) return;

      // Sin unidades disponibles no se procesa nada: solo se repinta el estado.
      if (cupo.restante <= 0) { refrescarCupos(); return; }

      const fila = btn.closest('.cambios-origen-item');
      const inputCant = fila && fila.querySelector('.cambios-cant-input');
      let cantidad = Math.max(1, parseInt(inputCant && inputCant.value, 10) || 1);
      // El atributo max del input es solo una ayuda del navegador: un valor
      // tecleado o pegado igual llega mas alto, asi que el recorte se hace aca.
      if (cantidad > cupo.restante) {
        cantidad = cupo.restante;
        if (inputCant) inputCant.value = String(cantidad);
      }
      procesarAccion(btn.getAttribute('data-accion'), idxItem, cantidad, cupo);
    });

    // El panel vive dentro del <form>: sin esto, un Enter en el campo de cantidad enviaría
    // la orden antes de tiempo. Acá Enter equivale a pulsar "Devolución" de esa misma fila.
    contOrigen.addEventListener('keydown', function(e) {
      if (e.key !== 'Enter' || !e.target.classList.contains('cambios-cant-input')) return;
      e.preventDefault();
      const fila = e.target.closest('.cambios-origen-item');
      const btn = fila && fila.querySelector('[data-accion="DEVOLUCION"]');
      if (btn) btn.click();
    });

    // Cerrar el desplegable de resultados al hacer clic fuera del buscador
    document.addEventListener('click', function(e) {
      if (!panel.contains(e.target)) ocultarResultados();
    });

    // F4 abre/cierra el panel; Escape lo cierra si no hay nada más abierto.
    document.addEventListener('keydown', function(e) {
      if (e.key === 'F4') { e.preventDefault(); alternar(); }
      else if (e.key === 'Escape' && !panel.hidden && document.activeElement !== input) {
        if (!hayOverlayAbierto()) cerrar();
      }
    });
  })();

  // === RESTAURAR MODO WHATSAPP TRAS UNA RECARGA ===
  // Debe ejecutarse después de ambos IIFEs: el de búsqueda manual asigna
  // `activarBusquedaManual` y el del modal expone `restaurarModoWhatsapp`.
  if (typeof window.restaurarModoWhatsapp === 'function') window.restaurarModoWhatsapp();

});