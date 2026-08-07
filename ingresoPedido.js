// Script para ingresoPedido.html: manejo de formulario, artículos dinámicos y registro en Firebase

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
  let articulosPorCodigo = {};
  let articulosPorNombre = {};

  // Radios de tipo de cliente
  let radiosTipoCliente = [];
  // Insertar radios de tipo de cliente debajo de Datos del Cliente
  const clienteSection = document.querySelector('section[aria-labelledby="datos-cliente-title"]');
  const extraClienteFields = document.getElementById('extraClienteFields');

  // Toggle para mostrar/ocultar campos extra del cliente
  (function() {
    const btn    = document.getElementById('toggleExtraClienteBtn');
    const arrow  = document.getElementById('toggleExtraClienteArrow');
    const label  = document.getElementById('toggleExtraClienteLabel');
    if (!btn || !extraClienteFields) return;
    btn.addEventListener('click', function() {
      const abierto = extraClienteFields.style.display !== 'none';
      extraClienteFields.style.display = abierto ? 'none' : '';
      arrow.textContent = abierto ? '▶' : '▼';
      label.textContent = abierto ? 'Ver más datos' : 'Ocultar datos';
    });
  })();

  window.expandirExtraCliente = function() {
    if (!extraClienteFields) return;
    extraClienteFields.style.display = '';
    const arrow = document.getElementById('toggleExtraClienteArrow');
    const label = document.getElementById('toggleExtraClienteLabel');
    if (arrow) arrow.textContent = '▼';
    if (label) label.textContent = 'Ocultar datos';
  };

  window.contraerExtraCliente = function() {
    if (!extraClienteFields) return;
    extraClienteFields.style.display = 'none';
    const arrow = document.getElementById('toggleExtraClienteArrow');
    const label = document.getElementById('toggleExtraClienteLabel');
    if (arrow) arrow.textContent = '▶';
    if (label) label.textContent = 'Ver más datos';
  };

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
        item.valorG = (item.valorU - item.valorC) * (item.cantidad || 1);
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
      articulosDisponibles.forEach(item => {
        // Usar Columna L (índice 11) para códigos de barras (puede contener múltiples códigos separados por comas)
        if (item[11]) {
          const codigosBarras = item[11].split(',');
          codigosBarras.forEach(codigo => {
            const codigoLimpio = codigo.trim();
            if (codigoLimpio) { // Solo agregar códigos no vacíos
              articulosPorCodigo[codigoLimpio] = item;
            }
          });
        }
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
  function imgFallbackAttrs(alt, fallbackJs = "this.style.display='none';") {
    return `referrerpolicy="no-referrer" data-alt="${alt || ''}" onerror="if(this.dataset.alt && this.dataset.fell!=='1'){this.dataset.fell='1';this.src=this.dataset.alt;}else{${fallbackJs}}"`;
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
    
    // Asignar categoria desde columna A (índice 0) - SIEMPRE
    item.categoria = art[0] || '';
    
    // Asignar seleccionado desde columna J (índice 9) - SIEMPRE
    item.seleccionado = art[9] || '';
    
    // Calcular valorG
    item.valorG = (item.valorU - item.valorC) * (item.cantidad || 1);
    
  }



  // === OPTIMIZACIÓN: CREAR UNA SOLA FILA ===
  function createRowElement(item, idx) {
    const imgs = obtenerImagenesArticulo(item.nombre);
    const primeraImagen = imgs.principal;

    const row = document.createElement('tr');
    row.setAttribute('data-idx', idx);

    row.innerHTML = `
      <td style="text-align:center;">
        ${primeraImagen ? `<img src="${primeraImagen}" class="articulo-img" style="width:50px;height:50px;object-fit:cover;border-radius:4px;cursor:pointer;" alt="Imagen del artículo" ${imgFallbackAttrs(imgs.alt)}>` : '<span style="color:#ccc;">Sin img</span>'}
      </td>
      <td><input type="text" value="${item.codigo || ''}" class="codigo" maxlength="20" style="width:80px" readonly></td>
      <td><div class="nombre-display" style="padding:8px;min-width:220px;">${item.nombre || ''}</div></td>
      <td><input type="number" value="${item.cantidad}" class="cantidad" min="1" style="width:60px"></td>
        <td><input type="number" value="${item.valorU}" class="valorU" min="0" step="1" style="width:80px"></td>
      <td class="valorTotal">${(item.cantidad * item.valorU).toLocaleString('es-AR', {maximumFractionDigits:0})}</td>
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
      debouncedRecargoUpdate();
    }, 50);
  }

  // === OPTIMIZACIÓN: ACTUALIZAR SOLO SUBTOTAL ===
  function updateSubtotal() {
    const subtotal = items.reduce((acc, it) => acc + (it.cantidad * it.valorU), 0);
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
      fragment.appendChild(row);
      
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
          
          task.item.valorG = (task.item.valorU - task.item.valorC) * (task.item.cantidad || 1);
          
          task.row.querySelector('.valorU').value = task.item.valorU;
          task.row.querySelector('.valorTotal').textContent = (task.item.cantidad * task.item.valorU).toLocaleString('es-AR', {maximumFractionDigits:0});
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
    
    if (articulosConNombre.length === 0) {
      // No hay artículos, ocultar contadores
      contadoresElement.style.display = 'none';
    } else {
      // Calcular cantidades
      const cantidadArticulosDistintos = articulosConNombre.length;
      const cantidadUnidadesTotales = articulosConNombre.reduce((total, item) => total + (item.cantidad || 0), 0);
      
      // Actualizar textos
      cantidadArticulosElement.textContent = `Artículos distintos: ${cantidadArticulosDistintos}`;
      cantidadUnidadesElement.textContent = `Unidades totales: ${cantidadUnidadesTotales}`;
      
      // Mostrar contadores con flex para alineación horizontal
      contadoresElement.style.display = 'flex';
    }
  }

  // Formateo numérico para todos los campos relacionados a valores
  function calcularTotalFinal() {
    let subtotal = items.reduce((acc, it) => acc + (it.cantidad * it.valorU), 0);
    let recargo = parseInt((recargoInput.value || '0').replace(/\D/g, '')) || 0;
    let descuento = parseInt((descuentoInput.value || '0').replace(/\D/g, '')) || 0;
    let envio = parseInt((envioInput.value || '0').replace(/\D/g, '')) || 0;
    // Si hay porcentaje, calcular recargo automáticamente
    if (recargoPorcentajeInput && recargoPorcentajeInput.value.trim() !== '') {
      let porcentajeR = recargoPorcentajeInput.value.replace(/[^\d.]/g, '');
      porcentajeR = parseFloat(porcentajeR);
      if (!isNaN(porcentajeR) && porcentajeR > 0) {
        recargo = Math.round(subtotal * (porcentajeR / 100));
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
        descuento = Math.round(subtotal * (porcentaje / 100));
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
    subtotalInput.value = formatMiles(subtotal);
    recargoInput.value = recargo ? formatMiles(recargo) : '';
    descuentoInput.value = descuento ? formatMiles(descuento) : '';
    envioInput.value = envio ? formatMiles(envio) : '';
    totalFinalInput.value = formatMiles(total);
  }


  // === OPTIMIZACIÓN: AGREGAR ITEM SIN RE-RENDERIZAR TODO ===


  // === SCANNER DE CÓDIGO DE BARRAS ===
  // === NUEVA FUNCIONALIDAD DE BÚSQUEDA DE ARTÍCULOS ===
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

  function initializeSearchArticulos() {
    if (!searchInput || !searchResults) return;
    
    let searchTimeout;
    
    // Configurar evento de input para búsqueda en tiempo real
    searchInput.addEventListener('input', function() {
      clearTimeout(searchTimeout);
      const query = this.value.trim().toLowerCase();
      
      // Limpiar selección previa al escribir
      selectedArticuloNombre = null;
      
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
        // Seleccionar artículo y mover al campo cantidad
        if (selectedResultIndex >= 0 && resultItems[selectedResultIndex]) {
          selectArticuloAndFocusQuantity(resultItems[selectedResultIndex]);
        } else if (resultItems[0]) {
          selectArticuloAndFocusQuantity(resultItems[0]);
        }
      } else if (e.key === 'Escape') {
        searchResults.style.display = 'none';
        searchResults.innerHTML = '';
        selectedResultIndex = -1;
        selectedArticuloNombre = null;
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
    
    // Botón de agregar
    if (addSearchItemBtn) {
      addSearchItemBtn.addEventListener('click', function() {
        if (selectedArticuloNombre) {
          addArticuloFromSearch(selectedArticuloNombre);
        }
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

    // Al abrir/cargar la página, posicionar el cursor en la búsqueda de artículos.
    setTimeout(() => searchInput.focus(), 100);
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
    
    // Verificar si el artículo ya existe en la lista
    const existingItemIndex = items.findIndex(item => item.nombre === nombreArticulo);
    
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
          const valorTotal = items[existingItemIndex].cantidad * items[existingItemIndex].valorU;
          valorTotalCell.textContent = valorTotal.toLocaleString('es-AR', {maximumFractionDigits:0});
        }
        
        // Actualizar valorG
        if (items[existingItemIndex].valorC) {
          items[existingItemIndex].valorG = (items[existingItemIndex].valorU - items[existingItemIndex].valorC) * items[existingItemIndex].cantidad;
        }
        
        // Highlight temporal de la fila
        existingRow.style.backgroundColor = '#e8f5e8';
        setTimeout(() => {
          existingRow.style.backgroundColor = '';
        }, 1500);
      }
      
      // Mostrar notificación
      showItemNotification(nombreArticulo, items[existingItemIndex].cantidad, true);
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
      itemsBody.appendChild(row);
      
      // Configurar event listeners para la nueva fila
      setupRowEventListeners(row, newIdx);
      
      // Highlight temporal de la nueva fila
      row.style.backgroundColor = '#e8f5e8';
      setTimeout(() => {
        row.style.backgroundColor = '';
      }, 1500);
      
      // Mostrar notificación
      showItemNotification(nombreArticulo, cantidadEspecificada, false);
    }
    
    // Recalcular totales
    debouncedCalculations();

    // La búsqueda manual es de un solo uso: se desactiva tras agregar cada artículo
    // para evitar el abuso de esta función de emergencia. En modo Whatsapp queda fija.
    if (busquedaManualHabilitada && !busquedaManualPersistente &&
        typeof desactivarBusquedaManual === 'function') {
      desactivarBusquedaManual();
    }

    // Limpiar búsqueda
    clearSearch();
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

  // === FUNCIÓN PARA MOSTRAR NOTIFICACIÓN CON IMAGEN (TOAST) ===
  function showItemNotification(nombreArticulo, cantidad, isIncrement = false) {
    // Obtener imagen del artículo
    const imgs = obtenerImagenesArticulo(nombreArticulo);
    const imagenUrl = imgs.principal;
    
    // Remover notificación anterior si existe
    const oldNotif = document.getElementById('barcodeToast');
    if (oldNotif) oldNotif.remove();
    
    // Crear contenedor de notificación
    const toast = document.createElement('div');
    toast.id = 'barcodeToast';
    toast.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: white;
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.2);
      padding: 16px;
      z-index: 10000;
      min-width: 320px;
      max-width: 400px;
      animation: slideIn 0.3s ease-out;
      border-left: 4px solid #28a745;
    `;
    
    // Crear contenido
    const imageHtml = imagenUrl ?
      `<img src="${imagenUrl}"
            style="width: 100%; height: 350px; object-fit: cover; border-radius: 8px; margin-bottom: 12px;"
            alt="${nombreArticulo}"
            ${imgFallbackAttrs(imgs.alt)}>` : '';
    
    const cantidadText = cantidad > 1 ? ` (${cantidad} unidades)` : '';
    const accionText = isIncrement ? '✅ Cantidad actualizada' : '✅ Artículo agregado';
    
    toast.innerHTML = `
      ${imageHtml}
      <div style="font-weight: 600; font-size: 14px; color: #28a745; margin-bottom: 6px;">
        ${accionText}
      </div>
      <div style="font-size: 15px; color: #333; font-weight: 500;">
        ${nombreArticulo}${cantidadText}
      </div>
    `;
    
    // Agregar estilos de animación
    if (!document.getElementById('barcodeToastStyles')) {
      const style = document.createElement('style');
      style.id = 'barcodeToastStyles';
      style.textContent = `
        @keyframes slideIn {
          from {
            transform: translateX(400px);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
        @keyframes slideOut {
          from {
            transform: translateX(0);
            opacity: 1;
          }
          to {
            transform: translateX(400px);
            opacity: 0;
          }
        }
      `;
      document.head.appendChild(style);
    }
    
    document.body.appendChild(toast);
    
    // Cerrar al hacer clic
    toast.addEventListener('click', () => {
      toast.style.animation = 'slideOut 0.3s ease-in';
      setTimeout(() => toast.remove(), 300);
    });
    
    // Auto-cerrar después de 4 segundos
    setTimeout(() => {
      if (toast.parentNode) {
        toast.style.animation = 'slideOut 0.3s ease-in';
        setTimeout(() => toast.remove(), 300);
      }
    }, 4000);
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
  });

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
      const newCantidad = Math.max(1, parseInt(target.value, 10) || 1);
      // Reflejar valor normalizado en el input
      if (String(newCantidad) !== target.value) target.value = String(newCantidad);
      if (items[idx].cantidad !== newCantidad) {
        items[idx].cantidad = newCantidad;
        needsRecalculation = true;

        // Actualizar valorG si hay artículo válido
        if (items[idx].nombre && articulosPorNombre[items[idx].nombre]) {
          items[idx].valorG = (items[idx].valorU - items[idx].valorC) * items[idx].cantidad;
        }

        // Actualizar valor total de la fila
        row.querySelector('.valorTotal').textContent = (items[idx].cantidad * items[idx].valorU).toLocaleString('es-AR', {maximumFractionDigits:0});
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
          items[idx].valorG = (items[idx].valorU - items[idx].valorC) * items[idx].cantidad;
        }

        // Actualizar valor total de la fila
        row.querySelector('.valorTotal').textContent = (items[idx].cantidad * items[idx].valorU).toLocaleString('es-AR', {maximumFractionDigits:0});
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
    ingresarPedido();
  });

  // Extraer la lógica de ingreso de pedido a una función reutilizable
  function ingresarPedido() {
    if (enviandoPedido) return;
    enviandoPedido = true;

    // Validar campos obligatorios
    const nombre = form.nombre.value.trim();
    const telefono = form.telefono.value.trim();
    const direccion = form.direccion.value.trim();
    const dni = form.dni.value.trim();
    const email = form.email.value.trim().toLowerCase();
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

    // Procesar y guardar subtotal y total como enteros (solo dígitos)
    function onlyDigits(str) {
      return (str + '').replace(/\D/g, '');
    }
    const recargo = parseInt(onlyDigits(form.recargo.value), 10) || 0;
    const descuento = parseInt(onlyDigits(form.descuento.value), 10) || 0;
    const envio = parseInt(onlyDigits(form.envio.value), 10) || 0;
    const subtotal = parseInt(onlyDigits(form.subtotal.value), 10) || 0;
    const totalFinal = parseInt(onlyDigits(form.totalFinal.value), 10) || 0;
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
      
      // FORZAR ACTUALIZACIÓN de todos los campos desde Google Sheets antes de guardar
      if (item.nombre && articulosPorNombre[item.nombre]) {
        const art = articulosPorNombre[item.nombre];
        // Forzar actualización de codigo, codigoBarras, categoria y seleccionado
        item.codigo = art[2] || '';
        item.codigoBarras = art[11] || '';
        item.categoria = art[0] || '';
        item.seleccionado = art[9] || '';
        // Forzar actualización de valorC
        let valorCRaw = art[7] || '0';
        valorCRaw = valorCRaw.replace(/\$/g, '').replace(/[.,]/g, '');
        item.valorC = parseInt(valorCRaw) || 0;
      } else {
        // Si no hay artículo válido, limpiar campos
        item.codigo = '';
        item.codigoBarras = '';
        item.categoria = '';
        item.seleccionado = '';
        item.valorC = 0;
      }
      
      // Asegurar que valorC nunca sea undefined (fallback adicional)
      if (typeof item.valorC === 'undefined' || item.valorC === null) {
        item.valorC = 0;
      }
      
      // Calcular valorG
      item.valorG = (item.valorU - item.valorC) * (item.cantidad || 1);
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
          cliente: { nombre, telefono, direccion, dni, email, tipoCliente },
          items: items.map(it => ({ codigo: it.codigo, codigoBarras: it.codigoBarras, nombre: it.nombre, cantidad: it.cantidad, valorU: it.valorU, valorC: it.valorC, categoria: it.categoria, seleccionado: it.seleccionado, valorG: it.valorG })),
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
                  window.location.href = 'ingresoPedido.html';
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
                  renderItems();
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                },
                function() { // No imprimir
                  showPopup('Pedido ingresado', '✅', true);
                  if (window.desactivarModoAdmin) window.desactivarModoAdmin();
                  if (window.contraerExtraCliente) window.contraerExtraCliente();
                  form.reset();
                  items = [];
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
          items.forEach((item, idx) => {
            if (item.nombre && articulosPorNombre[item.nombre]) {
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
        valorG: typeof it.valorG !== 'undefined' ? it.valorG : (typeof it.valorU !== 'undefined' && typeof it.valorC !== 'undefined' ? it.valorU - it.valorC : 0)
      }));
      renderItems();
      // Rellenar pagos
      form.medioPago.value = pedido.pagos?.medioPago || '';
      form.recargo.value = pedido.pagos?.recargo ? Number(String(pedido.pagos.recargo).replace(/\D/g, '')).toLocaleString('es-AR').replace(/,/g, '.') : '';
      form.descuento.value = pedido.pagos?.descuento ? Number(String(pedido.pagos.descuento).replace(/\D/g, '')).toLocaleString('es-AR').replace(/,/g, '.') : '';
      form.envio.value = pedido.pagos?.envio ? Number(String(pedido.pagos.envio).replace(/\D/g, '')).toLocaleString('es-AR').replace(/,/g, '.') : '';
      // Mostrar subtotal y total como enteros con separador de miles
      form.subtotal.value = pedido.pagos?.subtotal ? parseInt((pedido.pagos.subtotal + '').replace(/\D/g, ''), 10).toLocaleString('es-AR').replace(/,/g, '.') : '';
      form.totalFinal.value = pedido.pagos?.totalFinal ? parseInt((pedido.pagos.totalFinal + '').replace(/\D/g, ''), 10).toLocaleString('es-AR').replace(/,/g, '.') : '';
      // Autocompletar nota y vendedor si existen
      if (form.nota) form.nota.value = pedido.nota || '';
      if (form.vendedor) form.vendedor.value = pedido.vendedor || '';
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
          // Forzar actualización de valorC
          let valorCRaw = art[7] || '0';
          valorCRaw = valorCRaw.replace(/\$/g, '').replace(/[.,]/g, '');
          item.valorC = parseInt(valorCRaw) || 0;
        } else {
          // Si no hay artículo válido, limpiar campos
          item.codigo = '';
          item.codigoBarras = '';
          item.categoria = '';
          item.seleccionado = '';
          item.valorC = 0;
        }
        
        // Asegurar que valorC nunca sea undefined (fallback adicional)
        if (typeof item.valorC === 'undefined' || item.valorC === null) {
          item.valorC = 0;
        }
        
        // Calcular valorG
        item.valorG = (item.valorU - item.valorC) * (item.cantidad || 1);
      }
      // Procesar y guardar subtotal y total como enteros (solo dígitos)
      function onlyDigits(str) {
        return (str + '').replace(/\D/g, '');
      }
      const subtotal = parseInt(onlyDigits(form.subtotal.value), 10) || 0;
      const totalFinal = parseInt(onlyDigits(form.totalFinal.value), 10) || 0;
      const recargo = parseInt(onlyDigits(form.recargo.value), 10) || 0;
      const descuento = parseInt(onlyDigits(form.descuento.value), 10) || 0;
      const envio = parseInt(onlyDigits(form.envio.value), 10) || 0;
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
            cliente: { nombre: form.nombre.value.trim(), telefono: form.telefono.value.trim(), direccion: form.direccion.value.trim(), dni: form.dni.value.trim(), email: form.email.value.trim().toLowerCase(), tipoCliente: document.querySelector('input[name="tipoCliente"]:checked')?.value || '' },
            items: items.map(it => ({ codigo: it.codigo, codigoBarras: it.codigoBarras, nombre: it.nombre, cantidad: it.cantidad, valorU: it.valorU, valorC: it.valorC, categoria: it.categoria, seleccionado: it.seleccionado, valorG: it.valorG })),
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
            lastOrderUpdate: contrasena
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
                        window.location.href = 'ingresoPedido.html';
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
                        window.location.href = 'ingresoPedido.html';
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
    // Crear hash simple de los items para detectar cambios
    const currentHash = items.map(item => `${item.nombre}-${item.cantidad}`).join('|');
    
    if (costosCache !== null && lastItemsHash === currentHash) {
      return costosCache;
    }
    
    let costos = 0;
    items.forEach(item => {
      if (item.nombre && articulosPorNombre[item.nombre]) {
        const art = articulosPorNombre[item.nombre];
        // Usar valorC que ya está calculado en el item
        costos += (item.valorC || 0) * (item.cantidad || 0);
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

// Al salir del input nombre, validar si existe
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
  } else {
    // Mostrar modal para registrar cliente
    mostrarModalRegistroCliente(form.nombre.value.trim());
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
              <label style='margin-left:10px;'><input type='radio' name='tipoClienteModal' value='consumidor final' ${tipoClientePrellenado === 'consumidor final' ? 'checked' : ''}> Consumidor</label>
              <label style='margin-left:10px;'><input type='radio' name='tipoClienteModal' value='mayorista' ${tipoClientePrellenado === 'mayorista' ? 'checked' : ''}> Mayorista</label>
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
    const tipoClienteRadio = modal.querySelectorAll('input[name="tipoClienteModal"]');
    tipoClienteRadio.forEach(radio => {
      radio.checked = (radio.value === tipoClientePrellenado);
    });
    // Cambiar título y botón
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
  // Registrar/Guardar
  modal.querySelector('#formNuevoCliente').onsubmit = function(e) {
    e.preventDefault();
    const nombre = this.nombre.value.trim();
    let tipoCliente = 'consumidor final';
    const tipoRadio = this.querySelector('input[name="tipoClienteModal"]:checked');
    if (tipoRadio) tipoCliente = tipoRadio.value;
    if (!nombre || !tipoCliente) return;
    // Si es edición, actualiza el cliente en Firebase si existe
    if (esEdicion) {
      // Buscar el cliente por nombre (case-insensitive)
      const nombreKey = nombre.toLowerCase();
      let clienteId = null;
      let clienteEncontrado = null;
      // Buscar el id del cliente en el snapshot cargado
      db.ref('clientes').once('value').then(snap => {
        snap.forEach(child => {
          const cli = child.val();
          if (cli && cli.nombre && cli.nombre.toLowerCase() === nombreKey) {
            clienteId = child.key;
            clienteEncontrado = cli;
          }
        });
        if (clienteId) {
          db.ref('clientes/' + clienteId).update({ nombre, telefono: this.telefono.value.trim(), direccion: this.direccion.value.trim(), dni: this.dni.value.trim(), email: this.email.value.trim(), tipoCliente })
            .then(() => {
              cargarClientes();
              form.nombre.value = nombre;
              form.telefono.value = this.telefono.value.trim();
              form.direccion.value = this.direccion.value.trim();
              form.dni.value = this.dni.value.trim();
              form.email.value = this.email.value.trim();
              if (tipoCliente) {
                const radio = document.querySelector(`input[name="tipoCliente"][value="${tipoCliente}"]`);
                if (radio) radio.checked = true;
                tipoCliente = tipoCliente; // <-- ACTUALIZAR VARIABLE INTERNA
              }
              modal.remove();
            });
        } else {
          // Si no existe, solo actualiza el formulario
          form.nombre.value = nombre;
          form.telefono.value = this.telefono.value.trim();
          form.direccion.value = this.direccion.value.trim();
          form.dni.value = this.dni.value.trim();
          form.email.value = this.email.value.trim();
          if (tipoCliente) {
            const radio = document.querySelector(`input[name="tipoCliente"][value="${tipoCliente}"]`);
            if (radio) radio.checked = true;
            tipoCliente = tipoCliente; // <-- ACTUALIZAR VARIABLE INTERNA
          }
          modal.remove();
        }
      });
      return;
    }
    // Guardar en Firebase
    db.ref('clientes').push({ nombre, telefono: this.telefono.value.trim(), direccion: this.direccion.value.trim(), dni: this.dni.value.trim(), email: this.email.value.trim(), tipoCliente, registro: 'Local' })
      .then(() => {
        cargarClientes();
        form.nombre.value = nombre;
        form.telefono.value = this.telefono.value.trim();
        form.direccion.value = this.direccion.value.trim();
        form.dni.value = this.dni.value.trim();
        form.email.value = this.email.value.trim();
        if (tipoCliente) {
          const radio = document.querySelector(`input[name="tipoCliente"][value="${tipoCliente}"]`);
          if (radio) radio.checked = true;
        }
        modal.remove();
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
    data.push(escTxt(posWrap('Nombre: ' + d.nombre)));
    data.push(escTxt(posWrap('Telefono: ' + d.telefono)));
    data.push(escTxt(posSep()));

    d.items.forEach(it => {
      const cant = it.cantidad || 0;
      const vU = it.valorU || 0;
      const vTotal = cant * vU;
      const bc = ultimos5BC(it.codigoBarras);
      data.push(escCmd('1B4501'));
      data.push(escTxt(posWrap((it.nombre || '').toUpperCase())));
      data.push(escCmd('1B4500'));
      data.push(escTxt(posFila(cant + ' x ' + soloEntero(vU), soloEntero(vTotal))));
      data.push(escTxt(posWrap('COD.' + (it.codigo || '') + (bc ? ' - ' + bc : ''))));
    });

    data.push(escTxt(posSep()));
    data.push(escTxt(posFila('Subtotal', soloEntero(d.subtotal))));
    data.push(escTxt(posFila('Medio de Pago', d.medioPago)));
    if (parseFloat(d.recargo)) data.push(escTxt(posFila('Recargo', soloEntero(d.recargo))));
    if (parseFloat(d.descuento)) data.push(escTxt(posFila('Descuento', soloEntero(d.descuento))));
    if (parseFloat(d.envio)) data.push(escTxt(posFila('Costo de Envio', soloEntero(d.envio))));
    data.push(escCmd('1B4501'));
    data.push(escTxt(posFila('TOTAL', '$ ' + soloEntero(d.totalFinal))));
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
      const vTotal = cant * vU;
      const bc = ultimos5BC(it.codigoBarras);
      itemsHtml += `
        <div class="item">
          <div class="item-nombre">${(it.nombre || '').toUpperCase()}</div>
          <div class="item-linea">
            <span>${cant} x ${soloEntero(vU)}</span>
            <span>${soloEntero(vTotal)}</span>
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
          <div class="titulo">ORDEN DE PEDIDO</div>
          <div class="fecha">${d.fecha}</div>
          <hr class="sep">
          <div class="datos">
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
            <div class="tot-fila tot-final"><span>TOTAL</span><span>$ ${soloEntero(d.totalFinal)}</span></div>
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
      items: items.map(it => ({
        nombre: it.nombre, codigo: it.codigo, codigoBarras: it.codigoBarras,
        cantidad: it.cantidad, valorU: it.valorU
      }))
    };
    imprimirComprobante(d);
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

    // 2. Construir los nuevos movimientos (mismas validaciones, id y campos que antes).
    let exitosos = 0;
    for (const item of items) {
      if (!item || !item.codigo || !item.nombre || !item.cantidad || !item.valorU) {
        console.warn('⚠️ Item inválido, saltando:', item);
        errores.push(`Item inválido: ${item?.nombre || 'sin nombre'}`);
        continue;
      }

      const now = new Date();
      const pad = n => n.toString().padStart(2, '0');
      let id = `mov_${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}_${item.codigo}_${pedidoId}`;
      // Evitar que dos movimientos con mismo id (mismo codigo/segundo) se pisen dentro del mismo update.
      let movPath = 'movimientos/' + id;
      if (rootUpdates[movPath]) movPath = 'movimientos/' + id + '_' + exitosos;

      rootUpdates[movPath] = {
        timestamp: Date.now(),
        codigo: item.codigo,
        nombre: item.nombre,
        cantidad: parseInt(item.cantidad, 10) || 0,
        tipo: 'SALIDA',
        pedidoId: pedidoId
      };
      exitosos++;
    }

    if (exitosos === 0) {
      throw new Error('No se generaron movimientos válidos para el pedido.');
    }

    // 3. Incluir el pedido en la MISMA operación (sobrescribe el nodo = equivale a .set()).
    rootUpdates['pedidos/' + pedidoId] = pedidoObj;

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
    renderItems();
    
    // Limpiar buscador de artículos
    if (searchInput) searchInput.value = '';
    if (searchQuantity) searchQuantity.value = '1';
    if (searchResults) searchResults.innerHTML = '';
    
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
      if (form.vendedor) form.vendedor.value = 'WhatsApp';
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
      if (!pedidoId && form.vendedor && !form.vendedor.value) form.vendedor.value = 'WhatsApp';
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
    const PLACEHOLDER_MANUAL  = 'Buscar por nombre...';
    const HELP_BARCODE = '💡 Escanee o ingrese el <strong>código de barras</strong> del artículo, ajuste la cantidad y presione Enter o clic en Agregar.';
    const HELP_MANUAL  = '🔓 <strong>Búsqueda manual activa:</strong> puede buscar cualquier artículo por nombre. Pulse el botón para volver al modo código de barras.';

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
      if (manualLabel) manualLabel.textContent = 'Búsqueda manual activa';
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
      if (manualLabel) manualLabel.textContent = 'Búsqueda manual';
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

  // === RESTAURAR MODO WHATSAPP TRAS UNA RECARGA ===
  // Debe ejecutarse después de ambos IIFEs: el de búsqueda manual asigna
  // `activarBusquedaManual` y el del modal expone `restaurarModoWhatsapp`.
  if (typeof window.restaurarModoWhatsapp === 'function') window.restaurarModoWhatsapp();

});