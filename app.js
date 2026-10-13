/*****************************************************************
 * INVENTARIO GASES MEDICINALES — Clínica Reina Catalina
 *
 * La app guarda en el celular una copia del inventario y de los
 * movimientos, así funciona sin señal. Todo lo que se registra va
 * a una cola y se sube a Apps Script cuando hay conexión.
 *****************************************************************/

'use strict';

/***********************
 * UTILIDADES
 ***********************/

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const TIPOS = ['Retiro', 'Devolución', 'Ingreso'];
const TECNICOS_BASE = ['Jorge Ortiz', 'Kensy Díaz', 'Kevin Gamero'];

function $(id) { return document.getElementById(id); }

function esc(v) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function ico(nombre, clase) {
  return '<svg class="i' + (clase ? ' i-' + clase : '') + '" aria-hidden="true"><use href="#i-' + nombre + '"/></svg>';
}

function sinTildes(t) {
  return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function coincide(texto, busqueda) {
  const t = sinTildes(texto);
  return sinTildes(busqueda).split(/\s+/).filter(Boolean).every(function(p) { return t.indexOf(p) >= 0; });
}

function num(v) {
  const n = Number(String(v === null || v === undefined ? '' : v).replace(',', '.').trim());
  return isFinite(n) ? n : NaN;
}

function fmt(n) {
  return Number(n || 0).toLocaleString('es-CO', { maximumFractionDigits: 2 });
}

function uni(u) {
  const x = String(u || '').toUpperCase();
  if (x === 'UND') return 'und';
  if (x === 'MTS' || x === 'M') return 'm';
  return String(u || '').toLowerCase();
}

function fechaTxt(iso, conHora) {
  if (!iso) return 'Sin fecha';
  const d = new Date(iso);
  let t = d.getDate() + ' ' + MESES[d.getMonth()] + ' ' + d.getFullYear();
  if (conHora) t += ' · ' + horaTxt(d);
  return t;
}

/** Hora como se usa en Colombia: 1:55 p. m. */
function horaTxt(d) {
  const h = d.getHours();
  return (h % 12 || 12) + ':' + String(d.getMinutes()).padStart(2, '0') + (h < 12 ? ' a. m.' : ' p. m.');
}

function diaTxt(iso) {
  if (!iso) return 'Sin fecha';
  const d = new Date(iso);
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const dia = new Date(d); dia.setHours(0, 0, 0, 0);
  const dif = Math.round((hoy - dia) / 86400000);
  if (dif === 0) return 'Hoy';
  if (dif === 1) return 'Ayer';
  return fechaTxt(iso);
}

function nuevoId(prefijo) {
  return prefijo + Date.now().toString(36).toUpperCase() +
    Math.random().toString(36).slice(2, 6).toUpperCase();
}

function plural(n, uno, varios) { return n + ' ' + (n === 1 ? uno : varios); }

let relojToast = null;
function toast(texto, icono) {
  const capa = $('capaToast');
  capa.innerHTML = '<div class="toast" role="status">' + ico(icono || 'check') + '<span>' + esc(texto) + '</span></div>';
  clearTimeout(relojToast);
  relojToast = setTimeout(function() { capa.innerHTML = ''; }, 3200);
}


/***********************
 * ALMACÉN DEL CELULAR (IndexedDB)
 ***********************/

let bd = null;

function abrirBD() {
  return new Promise(function(resolve, reject) {
    const p = indexedDB.open('inventario-gases', 1);
    p.onupgradeneeded = function() { p.result.createObjectStore('datos'); };
    p.onsuccess = function() { bd = p.result; resolve(); };
    p.onerror = function() { reject(p.error); };
  });
}

function leerDato(clave) {
  return new Promise(function(resolve) {
    try {
      const r = bd.transaction('datos').objectStore('datos').get(clave);
      r.onsuccess = function() { resolve(r.result); };
      r.onerror = function() { resolve(undefined); };
    } catch (e) { resolve(undefined); }
  });
}

function guardarDato(clave, valor) {
  return new Promise(function(resolve) {
    try {
      const t = bd.transaction('datos', 'readwrite');
      t.objectStore('datos').put(valor, clave);
      t.oncomplete = function() { resolve(); };
      t.onerror = function() { resolve(); };
    } catch (e) { resolve(); }
  });
}

function ls(clave, valor) {
  try {
    if (valor === undefined) return JSON.parse(localStorage.getItem(clave) || 'null');
    if (valor === null) localStorage.removeItem(clave);
    else localStorage.setItem(clave, JSON.stringify(valor));
  } catch (e) { return null; }
}


/***********************
 * COMUNICACIÓN CON APPS SCRIPT
 ***********************/

const CLAVE_CODIGO = 'ig_codigo';

function codigoAcceso() {
  try { return localStorage.getItem(CLAVE_CODIGO) || ''; } catch (e) { return ''; }
}

function urlConfigurada() {
  return typeof URL_APPS_SCRIPT === 'string' && /^https?:\/\/.+\/exec$/.test(URL_APPS_SCRIPT.trim());
}

/** Envía una acción. Si no hay red, el error lleva sinRed = true. */
async function llamar(accion, extra, esperaMs, codigo) {
  if (!urlConfigurada()) {
    throw new Error('Falta configurar la app: pega la URL de Apps Script en config.js.');
  }
  const control = new AbortController();
  const reloj = setTimeout(function() { control.abort(); }, esperaMs || 60000);
  let respuesta;
  try {
    // Sin cabeceras: se envía como texto y el navegador no hace consulta previa
    respuesta = await fetch(URL_APPS_SCRIPT.trim(), {
      method: 'POST',
      body: JSON.stringify(Object.assign(
        { accion: accion, codigo: codigo === undefined ? codigoAcceso() : codigo }, extra || {})),
      redirect: 'follow',
      signal: control.signal
    });
  } catch (e) {
    const error = new Error('Sin conexión con el servidor.');
    error.sinRed = true;
    throw error;
  } finally {
    clearTimeout(reloj);
  }
  let json;
  try {
    json = await respuesta.json();
  } catch (e) {
    throw new Error('El servidor no respondió como se esperaba. Revisa que la implementación ' +
      'de Apps Script esté publicada con acceso para "Cualquier usuario".');
  }
  if (!json.ok) {
    const error = new Error(json.error || 'El servidor rechazó la solicitud.');
    error.codigo = json.codigo || '';
    throw error;
  }
  return json;
}


/***********************
 * ESTADO DE LA APP
 ***********************/

const S = {
  servidor: { articulos: [], movimientos: [], tecnicos: [], momento: null },
  cola: [],
  filtro: 'todos',
  busqueda: '',
  hist: { filtro: 'todos', busqueda: '' },
  form: null,
  artForm: null,
  sync: { estado: '', msg: '' },
  sincronizando: false,
  instalar: null,
  fotoPara: null
};

let M = null;   // modelo calculado (se borra cuando algo cambia)

function cambio() { M = null; }

/**
 * Une lo descargado del servidor con lo que está en la cola sin subir,
 * y calcula stock, pendientes y grupos (tickets).
 */
function modelo() {
  if (M) return M;

  const arts = new Map();
  S.servidor.articulos.forEach(function(a) {
    arts.set(a.id, Object.assign({}, a, { local: false }));
  });

  const movs = S.servidor.movimientos.map(function(r) {
    return { uid: r[0], grupo: r[1], fecha: r[2], tipo: r[3], ticket: r[4], tecnicos: r[5],
      destino: r[6], estado: r[7], art: r[8], cant: Number(r[9]) || 0, obs: r[10],
      origen: r[11], cierre: r[12], local: false };
  });

  function marcarLocal(grupo, estado) {
    movs.forEach(function(m) {
      if (m.grupo !== grupo || m.estado === 'Anulado') return;
      if (estado === 'Instalado' && m.estado !== 'Por instalar') return;
      m.estado = estado; m.local = true; m.cierre = new Date().toISOString();
    });
  }

  S.cola.forEach(function(op) {
    const p = op.payload;
    if (op.accion === 'articulo') {
      const prev = arts.get(p.a.id);
      arts.set(p.a.id, Object.assign({ inicial: Number(p.a.inicial) || 0, foto: '', miniatura: '' }, prev || {}, {
        id: p.a.id, categoria: p.a.categoria, nombre: p.a.nombre, unidad: p.a.unidad,
        minimo: p.a.minimo === '' || p.a.minimo === null ? null : Number(p.a.minimo), local: true }));
    } else if (op.accion === 'minimos') {
      Object.keys(p.valores).forEach(function(id) {
        const a = arts.get(id);
        if (a) { const v = p.valores[id]; a.minimo = v === '' || v === null ? null : Number(v); a.local = true; }
      });
    } else if (op.accion === 'foto') {
      const a = arts.get(p.id);
      if (a) { a.miniatura = p.miniatura; a.local = true; }
    } else if (op.accion === 'registrar') {
      const g = p.g;
      const signo = g.tipo === 'Retiro' ? -1 : 1;
      const estado = g.tipo === 'Retiro' ? g.estado : 'Registrado';
      g.items.forEach(function(it, n) {
        movs.push({ uid: g.id + '-' + (n + 1), grupo: g.id, fecha: g.fecha, tipo: g.tipo,
          ticket: g.ticket || '', tecnicos: g.tecnicos.join(', '), destino: g.destino, estado: estado,
          art: it[0], cant: signo * Math.abs(Number(it[1]) || 0), obs: g.obs || '', origen: g.origen || '',
          cierre: estado === 'Instalado' ? g.fecha : '', local: true });
      });
      if (g.origen && p.cerrarOrigen) marcarLocal(g.origen, 'Instalado');
    } else if (op.accion === 'estado') {
      marcarLocal(p.grupo, p.estado);
    }
  });

  arts.forEach(function(a) { a.stock = Number(a.inicial) || 0; a.pend = 0; });
  movs.forEach(function(m) {
    if (m.estado === 'Anulado') return;
    const a = arts.get(m.art);
    if (!a) return;
    a.stock += m.cant;
    if (m.tipo === 'Retiro' && m.estado === 'Por instalar') a.pend += -m.cant;
  });
  arts.forEach(function(a) {
    a.stock = Math.round(a.stock * 100) / 100;
    a.est = a.stock <= 0 ? 'agot' : (a.minimo > 0 && a.stock < a.minimo ? 'bajo' : 'ok');
  });

  const grupos = new Map();
  movs.forEach(function(m) {
    let g = grupos.get(m.grupo);
    if (!g) {
      g = { id: m.grupo, fecha: m.fecha, tipo: m.tipo, ticket: m.ticket, tecnicos: m.tecnicos,
        destino: m.destino, estado: m.estado, obs: m.obs, origen: m.origen, cierre: m.cierre,
        items: [], local: false };
      grupos.set(m.grupo, g);
    }
    g.items.push({ art: m.art, cant: m.cant });
    if (m.local) { g.local = true; g.estado = m.estado; g.cierre = m.cierre; }
  });

  const lista = Array.from(arts.values());
  const cats = [];
  lista.forEach(function(a) { if (cats.indexOf(a.categoria) < 0) cats.push(a.categoria); });

  M = { arts: arts, lista: lista, movs: movs, grupos: grupos, cats: cats };
  return M;
}

function tecnicos() {
  return S.servidor.tecnicos && S.servidor.tecnicos.length ? S.servidor.tecnicos : TECNICOS_BASE;
}

function nombreArt(id) {
  const a = modelo().arts.get(id);
  return a ? a.nombre : id;
}

function tagEstado(a) {
  if (a.est === 'agot') return '<span class="tag agot">' + ico('agotado', 's') + 'Agotado</span>';
  if (a.est === 'bajo') return '<span class="tag bajo">' + ico('alerta', 's') + 'Bajo</span>';
  return '<span class="tag ok">' + ico('check', 's') + 'OK</span>';
}

function etiquetaDestino(tipo) {
  return tipo === 'Retiro' ? 'Destino' : (tipo === 'Devolución' ? 'Viene de' : 'Proveedor');
}

function etiquetaTicket(tipo) {
  return tipo === 'Ingreso' ? 'Factura o remisión' : (tipo === 'Devolución' ? 'Ticket de origen' : 'N° ticket');
}

function tagGrupo(g) {
  if (g.estado === 'Anulado') return '<span class="tag gris">Anulado</span>';
  if (g.estado === 'Por instalar') return '<span class="tag bajo">' + ico('reloj', 's') + 'Por instalar</span>';
  if (g.estado === 'Instalado') return '<span class="tag ok">' + ico('check', 's') + 'Instalado</span>';
  return '<span class="tag neutro">' + esc(g.tipo) + '</span>';
}

function icoGrupo(g) {
  if (g.estado === 'Anulado') return ['anul', 'cerrar'];
  if (g.tipo === 'Retiro') return g.estado === 'Por instalar' ? ['pend', 'reloj'] : ['retiro', 'sale'];
  if (g.tipo === 'Devolución') return ['entra', 'vuelve'];
  return ['entra', 'entra'];
}


/***********************
 * NAVEGACIÓN
 ***********************/

let pila = [];

function rutaActual() { return location.hash || '#/inventario'; }

function ir(ruta) {
  if (rutaActual() === ruta) { render(); return; }
  location.hash = ruta;
}

function irTab(ruta) {
  pila = [ruta];
  if (rutaActual() === ruta) { render(); return; }
  location.replace(ruta);
}

function volver(defecto) {
  if (pila.length > 1) history.back();
  else { const r = defecto || '#/inventario'; pila = [r]; location.replace(r); }
}

window.addEventListener('hashchange', function() {
  const h = rutaActual();
  if (pila.length > 1 && pila[pila.length - 2] === h) pila.pop();
  else if (pila[pila.length - 1] !== h) pila.push(h);
  cerrarHoja();
  render();
  window.scrollTo(0, 0);
});

function partes() {
  const h = rutaActual().slice(2);
  const i = h.indexOf('?');
  const ruta = (i >= 0 ? h.slice(0, i) : h).split('/');
  const params = new URLSearchParams(i >= 0 ? h.slice(i + 1) : '');
  return { ruta: ruta, params: params };
}

function render() {
  const p = partes();
  const vista = p.ruta[0] || 'inventario';
  const html = {
    inventario: vInventario,
    item: function() { return vItem(p.ruta[1]); },
    mov: function() { return vMov(p.params); },
    pendientes: vPendientes,
    historial: vHistorial,
    minimos: vMinimos,
    articulo: function() { return vArticulo(p.ruta[1]); }
  }[vista];
  $('vista').innerHTML = html ? html() : vInventario();
  pintarNav(vista);
  pintarFranja();
  if (vista === 'inventario') pintarListaArt();
}

function pintarNav(vista) {
  if (['inventario', 'pendientes', 'historial'].indexOf(vista) < 0) { $('capaNav').innerHTML = ''; return; }
  const pend = Array.from(modelo().grupos.values()).filter(function(g) { return g.estado === 'Por instalar'; }).length;
  function tab(clave, ruta, icono, texto, extra) {
    return '<button class="tab" data-a="tab" data-x="' + ruta + '"' +
      (vista === clave ? ' aria-current="page"' : '') + '>' + ico(icono) + texto + (extra || '') + '</button>';
  }
  $('capaNav').innerHTML = '<nav class="nav" aria-label="Secciones"><div class="in">' +
    tab('inventario', '#/inventario', 'caja', 'Inventario') +
    '<button class="tab" data-a="ir" data-x="#/mov"><span class="mas">' + ico('mas') + '</span>Movimiento</button>' +
    tab('pendientes', '#/pendientes', 'reloj', 'Pendientes', pend ? '<span class="badge">' + pend + '</span>' : '') +
    tab('historial', '#/historial', 'lista', 'Historial') +
    '</div></nav>';
}


/***********************
 * FRANJA DE SINCRONIZACIÓN
 ***********************/

function franja() { return '<div id="franja" class="franja"></div>'; }

function pintarFranja() {
  const el = $('franja');
  if (!el) return;
  const n = S.cola.length;
  const cambios = plural(n, 'cambio', 'cambios');
  const ultima = S.servidor.momento ? fechaTxt(S.servidor.momento, true) : '';
  let clase = 'ok', icono = 'check', texto = '', botones = '';

  if (S.sync.estado === 'sube') {
    clase = 'sube'; icono = 'nube';
    texto = n ? 'Subiendo ' + cambios + '…' : 'Actualizando inventario…';
  } else if (S.sync.estado === 'error') {
    clase = 'error'; icono = 'alerta';
    texto = 'No se pudo subir: ' + S.sync.msg;
    botones = '<button data-a="reintentar">Reintentar</button>' +
      (n ? '<button data-a="descartarOp">Descartar</button>' : '');
  } else if (!navigator.onLine || S.sync.estado === 'sinred') {
    clase = 'espera'; icono = 'sinred';
    texto = n ? 'Sin señal · ' + cambios + ' por subir. Se suben solos al volver la señal.'
      : (ultima ? 'Sin señal · datos del ' + ultima : 'Sin señal · aún no hay datos descargados');
  } else if (n) {
    clase = 'espera'; icono = 'nube';
    texto = cambios.charAt(0).toUpperCase() + cambios.slice(1) + ' por subir';
    botones = '<button data-a="reintentar">Subir ya</button>';
  } else if (!S.servidor.momento) {
    clase = 'sube'; icono = 'nube'; texto = 'Descargando inventario…';
  } else {
    texto = 'Todo sincronizado · ' + horaTxt(new Date(S.servidor.momento)) + ' · funciona sin señal';
  }
  el.className = 'franja ' + clase;
  el.innerHTML = ico(icono, 'm') + '<span>' + esc(texto) + '</span>' + botones;
}


/***********************
 * VISTA: INVENTARIO
 ***********************/

function vInventario() {
  const m = modelo();
  const bajos = m.lista.filter(function(a) { return a.est === 'bajo'; }).length;
  const agot = m.lista.filter(function(a) { return a.est === 'agot'; }).length;
  const f = S.filtro;

  function chip(valor, texto, n) {
    return '<button class="chip" data-a="filtro" data-x="' + esc(valor) + '" aria-pressed="' + (f === valor) + '">' +
      esc(texto) + (n !== undefined ? '<span class="n">' + n + '</span>' : '') + '</button>';
  }

  return '<header class="cab">' +
      '<div class="fila">' +
        '<img class="logo" src="logo.jpg" alt="Logo Clínica Reina Catalina">' +
        '<div class="tit"><h1>Inventario Gases Medicinales</h1><small>Clínica Reina Catalina</small></div>' +
        (S.instalar ? '<button class="btn-cab txt" data-a="instalar">' + ico('instalar', 'm') + 'Instalar</button>' : '') +
        '<button class="btn-cab" data-a="opciones" aria-label="Más opciones">' + ico('menu') + '</button>' +
      '</div>' +
      '<label class="buscar">' + ico('buscar') +
        '<input id="busqueda" type="search" placeholder="Buscar: manguera, racor, ohmeda…" aria-label="Buscar artículo" value="' + esc(S.busqueda) + '" autocomplete="off">' +
        (S.busqueda ? '<button data-a="limpiarBusqueda" aria-label="Borrar búsqueda">' + ico('cerrar', 'm') + '</button>' : '') +
      '</label>' +
    '</header>' + franja() +
    '<div class="cuerpo">' +
      '<div class="resumen">' +
        '<button class="cifra" data-a="filtro" data-x="todos" aria-pressed="' + (f === 'todos') + '"><b>' + m.lista.length + '</b><span>Artículos</span></button>' +
        '<button class="cifra bajo" data-a="filtro" data-x="bajo" aria-pressed="' + (f === 'bajo') + '"><b>' + bajos + '</b><span>Bajo mínimo</span></button>' +
        '<button class="cifra agot" data-a="filtro" data-x="agot" aria-pressed="' + (f === 'agot') + '"><b>' + agot + '</b><span>Agotados</span></button>' +
      '</div>' +
      '<div class="chips" role="toolbar" aria-label="Filtros">' +
        chip('todos', 'Todos') + chip('revisar', 'Por revisar', bajos + agot) +
        m.cats.map(function(c) { return chip('cat:' + c, c); }).join('') +
      '</div>' +
      '<div id="listaArt" class="lista"></div>' +
    '</div>';
}

function pintarListaArt() {
  const el = $('listaArt');
  if (!el) return;
  const m = modelo();
  const f = S.filtro;
  const lista = m.lista.filter(function(a) {
    if (f === 'bajo' && a.est !== 'bajo') return false;
    if (f === 'agot' && a.est !== 'agot') return false;
    if (f === 'revisar' && a.est === 'ok') return false;
    if (f.indexOf('cat:') === 0 && a.categoria !== f.slice(4)) return false;
    if (S.busqueda && !coincide(a.nombre + ' ' + a.categoria, S.busqueda)) return false;
    return true;
  });

  if (!m.lista.length) {
    el.innerHTML = '<div class="vacio">' + ico('caja', 'l') + '<b>Aún no hay inventario en este celular</b>' +
      '<span>Se descarga al tener señal.</span></div>';
    return;
  }
  if (!lista.length) {
    el.innerHTML = '<div class="vacio">' + ico('buscar', 'l') + '<b>Nada coincide</b>' +
      '<span>' + (S.busqueda ? 'Prueba con otra palabra o ' : '') + 'cambia el filtro.</span>' +
      '<button class="btn sec chico" data-a="filtro" data-x="todos">Ver todos</button></div>';
    return;
  }

  const agrupar = f === 'todos' && !S.busqueda;
  let html = '', cat = null;
  lista.forEach(function(a) {
    if (agrupar && a.categoria !== cat) {
      cat = a.categoria;
      html += '<div class="seccion">' + esc(cat) + '</div>';
    }
    const sub = [];
    if (!agrupar) sub.push(a.categoria);
    sub.push(a.minimo > 0 ? 'mín. ' + fmt(a.minimo) + ' ' + uni(a.unidad) : 'sin mínimo');
    if (a.pend > 0) sub.push(fmt(a.pend) + ' en pendientes');
    html += '<button class="art" data-a="ir" data-x="#/item/' + esc(a.id) + '">' +
      '<span class="foto-mini">' + (a.miniatura ? '<img src="' + esc(a.miniatura) + '" alt="" loading="lazy">' : ico('camara')) + '</span>' +
      '<span class="txt"><span class="nom">' + esc(a.nombre) + '</span><span class="sub" style="display:block">' + esc(sub.join(' · ')) + '</span></span>' +
      '<span class="der"><span class="cant">' + fmt(a.stock) + ' <small>' + uni(a.unidad) + '</small></span>' + tagEstado(a) + '</span>' +
    '</button>';
  });
  el.innerHTML = html;
}


/***********************
 * VISTA: DETALLE DEL ARTÍCULO
 ***********************/

function cabSimple(titulo, sub, derecha) {
  return '<header class="cab"><div class="fila">' +
    '<button class="btn-cab" data-a="volver" aria-label="Volver">' + ico('atras') + '</button>' +
    '<div class="tit"><h1 style="font-size:17px">' + esc(titulo) + '</h1>' + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</div>' +
    (derecha || '') + '</div></header>';
}

function vItem(id) {
  const m = modelo();
  const a = m.arts.get(id);
  if (!a) {
    return cabSimple('Artículo') + '<div class="cuerpo"><div class="vacio"><b>No se encontró el artículo</b></div></div>';
  }
  const u = uni(a.unidad);
  const movs = m.movs.filter(function(x) { return x.art === id; }).sort(function(x, y) {
    return (y.fecha || '').localeCompare(x.fecha || '');
  });

  let foto;
  if (a.miniatura) {
    foto = '<div class="foto-grande con"><img src="' + esc(a.miniatura) + '" alt="Foto de ' + esc(a.nombre) + '">' +
      '<div class="acciones">' +
        (a.foto && navigator.onLine ? '<a class="btn" href="' + esc(a.foto) + '" target="_blank" rel="noopener">' + ico('abrir', 'm') + 'Foto completa</a>' : '') +
        '<button class="btn" data-a="foto" data-x="' + esc(id) + '">' + ico('camara', 'm') + 'Cambiar foto</button>' +
      '</div></div>';
  } else {
    foto = '<div class="foto-grande">' + ico('camara', 'l') + '<b style="font-size:14px">Aún sin foto</b>' +
      '<button class="btn chico" data-a="foto" data-x="' + esc(id) + '">' + ico('camara', 'm') + 'Tomar foto</button></div>';
  }

  let aviso = '';
  if (a.est === 'agot') aviso = '<div class="aviso agot" role="status">' + ico('agotado') + '<span>Agotado. Hay que pedir este artículo.</span></div>';
  else if (a.est === 'bajo') aviso = '<div class="aviso bajo" role="status">' + ico('alerta') + '<span>Está por debajo del mínimo (' + fmt(a.minimo) + ' ' + u + ').</span></div>';

  const filas = movs.length ? movs.map(function(x) {
    const g = m.grupos.get(x.grupo);
    const ic = icoGrupo(g);
    const meta = [diaTxt(x.fecha)];
    if (x.ticket) meta.push((x.tipo === 'Ingreso' ? 'Fact. ' : 'Ticket ') + x.ticket);
    meta.push(x.estado === 'Registrado' ? x.tipo : x.estado);
    if (x.local) meta.push('por subir');
    return '<button class="mov' + (x.estado === 'Anulado' ? ' anulado' : '') + '" data-a="grupo" data-x="' + esc(x.grupo) + '">' +
      '<span class="ico ' + ic[0] + '">' + ico(ic[1], 'm') + '</span>' +
      '<span class="txt"><span class="d" style="display:block">' + esc(x.destino || x.tipo) + '</span><span class="m">' + esc(meta.join(' · ')) + '</span></span>' +
      '<span class="q' + (x.cant > 0 ? ' mas' : '') + '">' + (x.cant > 0 ? '+' : '−') + fmt(Math.abs(x.cant)) + '</span></button>';
  }).join('') : '<p class="ayuda" style="padding:6px 0 12px">Sin movimientos todavía.</p>';

  return cabSimple('Detalle del artículo', '', '<button class="btn-cab" data-a="ir" data-x="#/articulo/' + esc(id) + '" aria-label="Editar artículo">' + ico('editar') + '</button>') +
    '<div class="cuerpo con-barra">' + foto +
      '<div><div class="kicker">' + esc(a.categoria) + '</div><h2 class="titulo-art">' + esc(a.nombre) + '</h2></div>' +
      '<div class="datos3">' +
        '<div class="dato"><span>Disponible</span><b>' + fmt(a.stock) + ' <small>' + u + '</small></b></div>' +
        '<button class="dato editable" data-a="editarMinimo" data-x="' + esc(id) + '" aria-label="Cambiar stock mínimo"><span>Mínimo ' + ico('editar', 's') + '</span><b>' + (a.minimo > 0 ? fmt(a.minimo) + ' <small>' + u + '</small>' : '<small>Definir</small>') + '</b></button>' +
        '<div class="dato"><span>En pendientes</span><b' + (a.pend > 0 ? ' style="color:var(--alerta-txt)"' : '') + '>' + fmt(a.pend) + ' <small>' + u + '</small></b></div>' +
      '</div>' + aviso +
      '<div class="tarjeta movs"><h2>Movimientos</h2>' + filas + '</div>' +
    '</div>' +
    '<div class="barra-inf"><div class="in">' +
      '<button class="btn sec" data-a="ir" data-x="#/mov?tipo=Ingreso&amp;item=' + esc(id) + '">' + ico('entra') + 'Ingresar</button>' +
      '<button class="btn" data-a="ir" data-x="#/mov?tipo=Retiro&amp;item=' + esc(id) + '"' + (a.stock <= 0 ? ' disabled' : '') + '>' + ico('sale') + (a.stock <= 0 ? 'Sin stock' : 'Retirar') + '</button>' +
    '</div></div>';
}


/***********************
 * VISTA: NUEVO MOVIMIENTO (un ticket, varios artículos)
 ***********************/

function formNuevo(clave, params) {
  const tipo = TIPOS.indexOf(params.get('tipo')) >= 0 ? params.get('tipo') : 'Retiro';
  const f = { clave: clave, tipo: tipo, ticket: '', sinTicket: false, destino: '',
    tecnicos: (ls('ig_tecnicos') || []).filter(function(t) { return tecnicos().indexOf(t) >= 0; }),
    items: [], estado: 'Por instalar', obs: '', origen: '', cerrarOrigen: true, intentado: false };

  const origen = params.get('origen');
  if (origen) {
    const g = modelo().grupos.get(origen);
    if (g) {
      f.tipo = 'Devolución';
      f.origen = origen;
      f.ticket = g.ticket;
      f.destino = g.destino;
      g.items.forEach(function(it) {
        if (it.cant < 0 && !f.items.some(function(x) { return x.id === it.art; })) f.items.push({ id: it.art, q: 0 });
      });
    }
  }
  const item = params.get('item');
  if (item && modelo().arts.has(item)) f.items.push({ id: item, q: 1 });
  return f;
}

function formVacio(f) {
  return !f || (!f.items.length && !f.destino.trim() && !String(f.ticket).trim() && !f.obs.trim());
}

function guardarBorrador() { ls('ig_borrador', S.form); }

function vMov(params) {
  const clave = rutaActual();
  if (!S.form || S.form.clave !== clave) {
    const borrador = S.form || ls('ig_borrador');
    const nuevo = formNuevo(clave, params);
    if (borrador && !formVacio(borrador) && borrador.clave !== clave) {
      // Hay uno sin terminar: se pregunta qué hacer
      S.form = borrador;
      S.form.clave = clave;
      setTimeout(function() { preguntarBorrador(borrador, nuevo); }, 0);
    } else {
      S.form = nuevo;
    }
    guardarBorrador();
  }
  return htmlMov();
}

function preguntarBorrador(viejo, nuevo) {
  abrirHoja('Movimiento sin terminar',
    '<p>Tienes un <b>' + esc(viejo.tipo.toLowerCase()) + '</b> sin guardar' +
    (viejo.items.length ? ' con ' + plural(viejo.items.length, 'artículo', 'artículos') : '') +
    (viejo.destino ? ' para <b>' + esc(viejo.destino) + '</b>' : '') + '.</p>',
    '<button class="btn sec" data-a="borradorNuevo">Empezar otro</button>' +
    '<button class="btn" data-a="cerrarHoja">Seguir con ese</button>');
  S.borradorNuevo = nuevo;
}

function lineaAyuda(f, it) {
  const m = modelo();
  const a = m.arts.get(it.id);
  if (!a) return { txt: 'Artículo no encontrado', cls: 'mal', mal: true };
  const u = uni(a.unidad);
  const q = num(it.q);
  if (!(q > 0)) {
    if (f.origen && f.tipo === 'Devolución') return { txt: 'No vuelve (queda en 0)', cls: '', mal: false, cero: true };
    return { txt: 'Escribe la cantidad', cls: 'mal', mal: true };
  }
  if (f.tipo === 'Retiro') {
    if (q > a.stock) return { txt: 'Solo hay ' + fmt(a.stock) + ' ' + u, cls: 'mal', mal: true };
    const queda = Math.round((a.stock - q) * 100) / 100;
    if (queda <= 0) return { txt: 'Quedará en 0: se agota', cls: 'alerta' };
    if (a.minimo > 0 && queda < a.minimo) return { txt: 'Quedarán ' + fmt(queda) + ': bajo el mínimo (' + fmt(a.minimo) + ')', cls: 'alerta' };
    return { txt: 'Hay ' + fmt(a.stock) + ' · quedarán ' + fmt(queda), cls: '' };
  }
  if (f.tipo === 'Devolución' && f.origen) {
    const g = m.grupos.get(f.origen);
    const salio = g ? -g.items.filter(function(x) { return x.art === it.id; }).reduce(function(s, x) { return s + x.cant; }, 0) : 0;
    if (q > salio) return { txt: 'En ese ticket salieron ' + fmt(salio) + ' ' + u, cls: 'mal', mal: true };
    return { txt: 'Salieron ' + fmt(salio) + ' · vuelven ' + fmt(q), cls: '' };
  }
  return { txt: 'Hay ' + fmt(a.stock) + ' · quedarán ' + fmt(a.stock + q), cls: '' };
}

function erroresForm(f) {
  const e = {};
  if (!f.tecnicos.length) e.tec = 'Elige quién hace el movimiento.';
  if (!f.destino.trim()) e.destino = 'Escribe ' + etiquetaDestino(f.tipo).toLowerCase() + '.';
  if (f.tipo === 'Retiro' && !f.sinTicket && !String(f.ticket).trim()) e.ticket = 'Escribe el ticket o marca "Sin ticket".';
  const validas = f.items.filter(function(it) { return num(it.q) > 0; });
  if (!validas.length) e.items = 'Agrega al menos un artículo con cantidad.';
  if (f.items.some(function(it) { return lineaAyuda(f, it).mal; })) e.items = e.items || 'Revisa las cantidades marcadas en rojo.';
  return e;
}

function avisoTicket(f) {
  const t = String(f.ticket).trim();
  if (f.tipo !== 'Retiro' || !t || f.sinTicket) return '';
  const otro = Array.from(modelo().grupos.values()).find(function(g) {
    return g.tipo === 'Retiro' && g.estado !== 'Anulado' && String(g.ticket) === t;
  });
  return otro ? 'El ticket ' + t + ' ya tiene un retiro (' + otro.destino + '). Revisa que sea otro.' : '';
}

function errorHtml(id, txt) {
  return '<div class="error" id="' + id + '" role="alert">' + (txt ? ico('alerta', 's') + esc(txt) : '') + '</div>';
}

function htmlLinea(f, it, i) {
  const a = modelo().arts.get(it.id);
  const ay = lineaAyuda(f, it);
  const mostrarError = ay.mal && (f.intentado || num(it.q) > 0);
  return '<div class="linea" id="linea-' + i + '">' +
    '<div class="txt"><div class="nom">' + esc(a ? a.nombre : it.id) + '</div>' +
      '<div class="ayuda ' + (mostrarError || ay.cls === 'alerta' ? ay.cls : '') + '" id="ayuda-' + i + '">' + esc(ay.txt) + '</div></div>' +
    '<button class="paso" data-a="paso" data-x="' + i + '" data-d="-1" aria-label="Restar">' + ico('menos', 'm') + '</button>' +
    '<input class="num" data-campo="q" data-i="' + i + '" inputmode="decimal" value="' + esc(it.q) + '" aria-label="Cantidad de ' + esc(a ? a.nombre : '') + ' en ' + (a ? uni(a.unidad) : '') + '"' + (mostrarError ? ' aria-invalid="true"' : '') + '>' +
    '<button class="paso" data-a="paso" data-x="' + i + '" data-d="1" aria-label="Sumar">' + ico('mas', 'm') + '</button>' +
    '<button class="quitar" data-a="quitarLinea" data-x="' + i + '" aria-label="Quitar ' + esc(a ? a.nombre : '') + '">' + ico('basura', 'm') + '</button>' +
  '</div>';
}

function htmlMov() {
  const f = S.form;
  const m = modelo();
  const e = f.intentado ? erroresForm(f) : {};
  const ahora = new Date();
  const origen = f.origen ? m.grupos.get(f.origen) : null;

  const destinos = [];
  m.movs.slice().reverse().forEach(function(x) {
    if (x.tipo === f.tipo && x.destino && destinos.indexOf(x.destino) < 0) destinos.push(x.destino);
  });

  const tipoBtns = TIPOS.map(function(t) {
    return '<button role="radio" data-a="tipo" data-x="' + t + '" aria-checked="' + (f.tipo === t) + '"' +
      (origen && t !== 'Devolución' ? ' disabled' : '') + '>' + t + '</button>';
  }).join('');

  const tecBtns = tecnicos().map(function(t) {
    const on = f.tecnicos.indexOf(t) >= 0;
    return '<button class="opcion" data-a="tecnico" data-x="' + esc(t) + '" aria-pressed="' + on + '">' + (on ? ico('check', 's') : '') + esc(t) + '</button>';
  }).join('');

  const aviso = avisoTicket(f);
  let cuerpo = '';

  if (origen) {
    cuerpo += '<div class="aviso info">' + ico('vuelve') + '<span>Devolución del sobrante del ' +
      (origen.ticket ? 'ticket ' + esc(origen.ticket) : 'retiro') + ' · ' + esc(origen.destino) +
      '. Deja en 0 lo que no vuelve.</span></div>';
  } else {
    cuerpo += '<div class="segmento" role="radiogroup" aria-label="Tipo de movimiento">' + tipoBtns + '</div>';
  }

  cuerpo += '<div class="dos">' +
      '<div class="campo"><label class="lbl" for="fTicket">' + etiquetaTicket(f.tipo) + (f.tipo === 'Retiro' ? '' : ' <small>(opcional)</small>') + '</label>' +
        '<input class="inp" id="fTicket" data-campo="ticket" ' + (f.tipo === 'Ingreso' ? '' : 'inputmode="numeric" ') + 'value="' + esc(f.ticket) + '"' +
        (f.sinTicket && f.tipo === 'Retiro' ? ' disabled' : '') + (e.ticket ? ' aria-invalid="true"' : '') + '></div>' +
      '<div class="campo"><label class="lbl" for="fDestino">' + etiquetaDestino(f.tipo) + '</label>' +
        '<input class="inp" id="fDestino" data-campo="destino" list="listaDestinos" autocapitalize="characters" value="' + esc(f.destino) + '"' +
        ' placeholder="' + (f.tipo === 'Retiro' ? 'HABITACIÓN 601' : (f.tipo === 'Ingreso' ? 'PROVEEDOR' : 'HABITACIÓN, ÁREA…')) + '"' + (e.destino ? ' aria-invalid="true"' : '') + '>' +
        '<datalist id="listaDestinos">' + destinos.slice(0, 40).map(function(d) { return '<option value="' + esc(d) + '">'; }).join('') + '</datalist></div>' +
    '</div>';

  if (f.tipo === 'Retiro') {
    cuerpo += '<label class="check"><input type="checkbox" data-campo="sinTicket"' + (f.sinTicket ? ' checked' : '') + '>Sin ticket</label>';
  }
  cuerpo += errorHtml('err-ticket', e.ticket) + errorHtml('err-destino', e.destino) +
    '<div class="ayuda alerta" id="aviso-ticket">' + esc(aviso) + '</div>';

  cuerpo += '<div class="campo"><span class="lbl">Técnicos</span><div class="opciones">' + tecBtns + '</div>' + errorHtml('err-tec', e.tec) + '</div>';

  cuerpo += '<div class="tarjeta items"><div class="top"><b>Artículos (' + f.items.length + ')</b>' +
      '<button class="agregar" data-a="elegirArt">' + ico('mas', 'm') + 'Agregar</button></div>' +
      (f.items.length ? f.items.map(function(it, i) { return htmlLinea(f, it, i); }).join('')
        : '<p class="ayuda" style="padding:4px 0 8px">Toca "Agregar" para elegir el material.</p>') +
      errorHtml('err-items', e.items) +
    '</div>';

  if (f.tipo === 'Retiro') {
    cuerpo += '<div class="campo"><span class="lbl">Estado del trabajo</span><div class="estado2" role="radiogroup" aria-label="Estado del trabajo">' +
      '<button class="pend" role="radio" data-a="estadoForm" data-x="Por instalar" aria-checked="' + (f.estado === 'Por instalar') + '">' + ico('reloj', 'm') + 'Por instalar</button>' +
      '<button class="inst" role="radio" data-a="estadoForm" data-x="Instalado" aria-checked="' + (f.estado === 'Instalado') + '">' + ico('check', 'm') + 'Instalado</button>' +
    '</div></div>';
  }
  if (origen) {
    cuerpo += '<label class="check"><input type="checkbox" data-campo="cerrarOrigen"' + (f.cerrarOrigen ? ' checked' : '') + '>Marcar ese retiro como instalado</label>';
  }
  cuerpo += '<div class="campo"><label class="lbl" for="fObs">Observación <small>(opcional)</small></label>' +
    '<textarea class="inp" id="fObs" data-campo="obs">' + esc(f.obs) + '</textarea></div>';

  const textoGuardar = { 'Retiro': 'Guardar retiro', 'Devolución': 'Guardar devolución', 'Ingreso': 'Guardar ingreso' }[f.tipo];

  return '<header class="cab"><div class="fila">' +
      '<button class="btn-cab" data-a="cancelarMov" aria-label="Cerrar">' + ico('cerrar') + '</button>' +
      '<div class="tit"><h1 style="font-size:17px">Nuevo movimiento</h1><small>' + esc(fechaTxt(ahora.toISOString(), true)) + ' (automático)</small></div>' +
    '</div></header>' +
    '<div class="cuerpo con-barra">' + cuerpo + '</div>' +
    '<div class="barra-inf"><div class="in"><button class="btn" data-a="guardarMov">' + ico('check') + textoGuardar + '</button></div></div>';
}

function repintarMov() {
  const y = window.scrollY;
  $('vista').innerHTML = htmlMov();
  window.scrollTo(0, y);
}

function refrescarErroresMov() {
  const f = S.form;
  const av = $('aviso-ticket');
  if (av) av.textContent = avisoTicket(f);
  if (!f.intentado) return;
  const e = erroresForm(f);
  [['err-ticket', e.ticket, 'fTicket'], ['err-destino', e.destino, 'fDestino'], ['err-tec', e.tec], ['err-items', e.items]].forEach(function(x) {
    const el = $(x[0]);
    if (el) el.innerHTML = x[1] ? ico('alerta', 's') + esc(x[1]) : '';
    if (x[2] && $(x[2])) $(x[2]).setAttribute('aria-invalid', x[1] ? 'true' : 'false');
  });
}

function refrescarLinea(i) {
  const f = S.form;
  const it = f.items[i];
  const el = $('ayuda-' + i);
  if (!it || !el) return;
  const ay = lineaAyuda(f, it);
  const mostrar = ay.mal && (f.intentado || num(it.q) > 0);
  el.className = 'ayuda ' + (mostrar || ay.cls === 'alerta' ? ay.cls : '');
  el.textContent = ay.txt;
  const inp = document.querySelector('[data-campo="q"][data-i="' + i + '"]');
  if (inp) inp.setAttribute('aria-invalid', mostrar ? 'true' : 'false');
}

function guardarMov() {
  const f = S.form;
  const e = erroresForm(f);
  if (Object.keys(e).length) {
    f.intentado = true;
    repintarMov();
    const primero = document.querySelector('.error:not(:empty)');
    if (primero) primero.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return;
  }
  let obs = f.obs.trim();
  if (f.tipo === 'Retiro' && f.sinTicket) obs = 'Sin ticket' + (obs ? ' · ' + obs : '');
  const g = {
    id: nuevoId('G'),
    fecha: new Date().toISOString(),
    tipo: f.tipo,
    ticket: f.tipo === 'Retiro' && f.sinTicket ? '' : String(f.ticket).trim(),
    tecnicos: f.tecnicos.slice(),
    destino: f.destino.trim().toUpperCase(),
    estado: f.tipo === 'Retiro' ? f.estado : 'Registrado',
    obs: obs,
    origen: f.origen || '',
    items: f.items.filter(function(it) { return num(it.q) > 0; }).map(function(it) { return [it.id, num(it.q)]; })
  };
  encolar('registrar', { g: g, cerrarOrigen: !!(f.origen && f.cerrarOrigen) });
  ls('ig_tecnicos', f.tecnicos);
  S.form = null;
  ls('ig_borrador', null);
  toast(g.tipo + ' guardado' + (navigator.onLine ? '' : ' · se sube al volver la señal'));
  volver();
  sincronizar();
}


/***********************
 * VISTA: PENDIENTES POR INSTALAR
 ***********************/

function resumenItems(g, max) {
  const its = g.items.map(function(it) {
    const a = modelo().arts.get(it.art);
    return (a ? a.nombre : it.art) + ' ×' + fmt(Math.abs(it.cant)) + (a && uni(a.unidad) === 'm' ? ' m' : '');
  });
  const extra = its.length > max ? ' y ' + (its.length - max) + ' más' : '';
  return its.slice(0, max).join(', ') + extra;
}

function edadGrupo(g) {
  if (!g.fecha) return { txt: 'Sin fecha', cls: 'agot' };
  const dias = Math.floor((Date.now() - new Date(g.fecha)) / 86400000);
  const txt = dias <= 0 ? 'Hoy' : (dias === 1 ? 'Ayer' : 'Hace ' + dias + ' días');
  return { txt: txt, cls: dias > 7 ? 'agot' : 'bajo' };
}

function vPendientes() {
  const lista = Array.from(modelo().grupos.values())
    .filter(function(g) { return g.estado === 'Por instalar'; })
    .sort(function(a, b) { return (a.fecha || '').localeCompare(b.fecha || ''); });

  const tarjetas = lista.length ? lista.map(function(g) {
    const ed = edadGrupo(g);
    const meta = (g.ticket ? 'Ticket ' + g.ticket : 'Sin ticket') + ' · ' + g.tecnicos;
    return '<div class="tarjeta tk">' +
      '<button class="cab2" data-a="grupo" data-x="' + esc(g.id) + '">' +
        '<span class="txt"><span class="d" style="display:block">' + esc(g.destino) + '</span><span class="m" style="display:block">' + esc(meta) + (g.local ? ' · por subir' : '') + '</span></span>' +
        '<span class="tag ' + ed.cls + '">' + ico('reloj', 's') + ed.txt + '</span></button>' +
      '<div class="its">' + esc(resumenItems(g, 4)) + '</div>' +
      '<div class="bts">' +
        '<button class="btn sec chico" data-a="ir" data-x="#/mov?origen=' + esc(g.id) + '">Devolver sobrante</button>' +
        '<button class="btn verde chico" data-a="instalado" data-x="' + esc(g.id) + '">' + ico('check', 'm') + 'Instalado</button>' +
      '</div></div>';
  }).join('') : '<div class="vacio">' + ico('check', 'l') + '<b>No hay retiros pendientes</b><span>Todo lo retirado está instalado.</span></div>';

  return '<header class="cab"><div class="tit"><h1>Pendientes por instalar</h1>' +
    '<small>' + plural(lista.length, 'retiro', 'retiros') + ' · el material ya salió del inventario</small></div></header>' +
    franja() + '<div class="cuerpo"><div class="lista">' + tarjetas + '</div></div>';
}


/***********************
 * VISTA: HISTORIAL
 ***********************/

function vHistorial() {
  const h = S.hist;
  function chip(v, t) {
    return '<button class="chip" data-a="filtroHist" data-x="' + v + '" aria-pressed="' + (h.filtro === v) + '">' + t + '</button>';
  }
  return '<header class="cab"><div class="tit"><h1>Historial</h1><small>Retiros, devoluciones e ingresos</small></div>' +
      '<label class="buscar">' + ico('buscar') +
        '<input id="busquedaHist" type="search" placeholder="Ticket, destino, artículo…" aria-label="Buscar en el historial" value="' + esc(h.busqueda) + '" autocomplete="off"></label>' +
    '</header>' + franja() +
    '<div class="cuerpo">' +
      '<div class="chips" role="toolbar" aria-label="Filtrar historial">' +
        chip('todos', 'Todos') + chip('Retiro', 'Retiros') + chip('Devolución', 'Devoluciones') +
        chip('Ingreso', 'Ingresos') + chip('Anulado', 'Anulados') +
      '</div>' +
      '<div id="listaHist" class="lista">' + htmlListaHist() + '</div>' +
    '</div>';
}

function htmlListaHist() {
  const h = S.hist;
  const m = modelo();
  const lista = Array.from(m.grupos.values()).filter(function(g) {
    if (h.filtro === 'Anulado') { if (g.estado !== 'Anulado') return false; }
    else if (h.filtro !== 'todos' && g.tipo !== h.filtro) return false;
    if (h.busqueda) {
      const txt = [g.destino, g.ticket, g.tecnicos, g.obs, g.items.map(function(i) { return nombreArt(i.art); }).join(' ')].join(' ');
      if (!coincide(txt, h.busqueda)) return false;
    }
    return true;
  }).sort(function(a, b) {
    if (!a.fecha !== !b.fecha) return a.fecha ? -1 : 1;
    return (b.fecha || '').localeCompare(a.fecha || '');
  });

  if (!lista.length) {
    return '<div class="vacio">' + ico('lista', 'l') + '<b>Sin movimientos</b><span>No hay nada con ese filtro.</span></div>';
  }
  let html = '', dia = null;
  lista.forEach(function(g) {
    const d = diaTxt(g.fecha);
    if (d !== dia) { dia = d; html += '<div class="fecha-sec">' + esc(d) + '</div>'; }
    const ic = icoGrupo(g);
    const meta = [];
    if (g.ticket) meta.push((g.tipo === 'Ingreso' ? 'Fact. ' : 'Ticket ') + g.ticket);
    meta.push(plural(g.items.length, 'artículo', 'artículos'));
    if (g.local) meta.push('por subir');
    html += '<button class="hist' + (g.estado === 'Anulado' ? ' anulado' : '') + '" data-a="grupo" data-x="' + esc(g.id) + '">' +
      '<span class="ico ' + ic[0] + '" style="width:40px;height:40px;border-radius:10px;display:grid;place-items:center;flex:none">' + ico(ic[1], 'm') + '</span>' +
      '<span class="txt"><span class="d" style="display:block">' + esc(g.tipo + ' · ' + g.destino) + '</span><span class="m">' + esc(meta.join(' · ')) + '</span></span>' +
      tagGrupo(g) + '</button>';
  });
  return html;
}


/***********************
 * VISTA: STOCK MÍNIMO (todos a la vez)
 ***********************/

function vMinimos() {
  const m = modelo();
  let html = '', cat = null;
  m.lista.forEach(function(a) {
    if (a.categoria !== cat) { cat = a.categoria; html += '<div class="seccion">' + esc(cat) + '</div>'; }
    html += '<div class="art" style="cursor:default">' +
      '<span class="txt"><label class="nom" for="min-' + esc(a.id) + '" style="display:block">' + esc(a.nombre) + '</label>' +
      '<span class="sub" style="display:block">Hay ' + fmt(a.stock) + ' ' + uni(a.unidad) + '</span></span>' +
      '<input class="num" style="width:72px;min-height:44px" id="min-' + esc(a.id) + '" data-min="' + esc(a.id) + '" inputmode="decimal" value="' + (a.minimo > 0 ? esc(a.minimo) : '') + '" placeholder="—">' +
      '<span class="ayuda" style="width:24px">' + uni(a.unidad) + '</span></div>';
  });
  return cabSimple('Stock mínimo', 'Cuánto debe haber como mínimo de cada artículo') +
    '<div class="cuerpo con-barra"><div class="aviso info">' + ico('alerta') +
    '<span>Cuando el stock baje de este número, el artículo se marca "Bajo". Déjalo vacío si no necesita mínimo.</span></div>' +
    '<div class="lista">' + html + '</div></div>' +
    '<div class="barra-inf"><div class="in"><button class="btn" data-a="guardarMinimos">' + ico('check') + 'Guardar mínimos</button></div></div>';
}

function guardarMinimos() {
  const m = modelo();
  const valores = {};
  let malo = null;
  document.querySelectorAll('[data-min]').forEach(function(inp) {
    const id = inp.getAttribute('data-min');
    const t = inp.value.trim();
    const v = t === '' ? null : num(t);
    if (t !== '' && !(v >= 0)) { malo = malo || inp; inp.setAttribute('aria-invalid', 'true'); return; }
    inp.setAttribute('aria-invalid', 'false');
    const a = m.arts.get(id);
    const actual = a.minimo > 0 ? a.minimo : null;
    if ((v || null) !== actual) valores[id] = v || null;
  });
  if (malo) { malo.focus(); toast('Revisa el número marcado en rojo', 'alerta'); return; }
  const n = Object.keys(valores).length;
  if (!n) { toast('No cambiaste ningún mínimo', 'alerta'); return; }
  encolar('minimos', { valores: valores });
  toast(plural(n, 'mínimo guardado', 'mínimos guardados'));
  volver();
  sincronizar();
}


/***********************
 * VISTA: NUEVO / EDITAR ARTÍCULO
 ***********************/

function vArticulo(id) {
  const m = modelo();
  const nuevo = !id || id === 'nuevo';
  if (!S.artForm || S.artForm.clave !== rutaActual()) {
    const a = nuevo ? null : m.arts.get(id);
    S.artForm = { clave: rutaActual(), id: nuevo ? null : id, nombre: a ? a.nombre : '',
      categoria: a ? a.categoria : '', otra: '', unidad: a ? a.unidad : 'UND',
      inicial: '', minimo: a && a.minimo > 0 ? String(a.minimo) : '', intentado: false };
  }
  const f = S.artForm;
  const e = f.intentado ? erroresArt(f) : {};
  const cats = m.cats.slice();
  const catBtns = cats.map(function(c) {
    return '<button class="opcion" data-a="artCat" data-x="' + esc(c) + '" aria-pressed="' + (f.categoria === c) + '">' + esc(c) + '</button>';
  }).join('') + '<button class="opcion" data-a="artCat" data-x="__otra" aria-pressed="' + (f.categoria === '__otra') + '">Otra…</button>';

  return cabSimple(nuevo ? 'Nuevo artículo' : 'Editar artículo') +
    '<div class="cuerpo con-barra">' +
      '<div class="campo"><label class="lbl" for="aNombre">Nombre</label>' +
        '<input class="inp" id="aNombre" data-art="nombre" value="' + esc(f.nombre) + '" placeholder="Ej: Toma Ohmeda oxígeno completo"' + (e.nombre ? ' aria-invalid="true"' : '') + '>' +
        errorHtml('err-aNombre', e.nombre) + '</div>' +
      '<div class="campo"><span class="lbl">Categoría</span><div class="opciones">' + catBtns + '</div>' +
        (f.categoria === '__otra' ? '<input class="inp" data-art="otra" aria-label="Nombre de la nueva categoría" value="' + esc(f.otra) + '" placeholder="Nombre de la categoría">' : '') +
        errorHtml('err-aCat', e.categoria) + '</div>' +
      '<div class="campo"><span class="lbl">Unidad</span><div class="opciones" role="radiogroup" aria-label="Unidad">' +
        '<button class="opcion" role="radio" data-a="artUni" data-x="UND" aria-checked="' + (f.unidad === 'UND') + '">Unidades</button>' +
        '<button class="opcion" role="radio" data-a="artUni" data-x="MTS" aria-checked="' + (f.unidad === 'MTS') + '">Metros</button>' +
      '</div></div>' +
      '<div class="dos" style="grid-template-columns:repeat(2,minmax(0,1fr))">' +
        (nuevo ? '<div class="campo"><label class="lbl" for="aInicial">Cantidad que hay hoy</label>' +
          '<input class="inp" id="aInicial" data-art="inicial" inputmode="decimal" value="' + esc(f.inicial) + '" placeholder="0"' + (e.inicial ? ' aria-invalid="true"' : '') + '>' +
          errorHtml('err-aInicial', e.inicial) + '</div>' : '') +
        '<div class="campo"><label class="lbl" for="aMinimo">Stock mínimo <small>(opcional)</small></label>' +
          '<input class="inp" id="aMinimo" data-art="minimo" inputmode="decimal" value="' + esc(f.minimo) + '" placeholder="—"' + (e.minimo ? ' aria-invalid="true"' : '') + '>' +
          errorHtml('err-aMinimo', e.minimo) + '</div>' +
      '</div>' +
      (nuevo ? '' : '<p class="ayuda">La cantidad disponible no se edita aquí: cambia con ingresos, retiros y devoluciones.</p>') +
    '</div>' +
    '<div class="barra-inf"><div class="in"><button class="btn" data-a="guardarArt">' + ico('check') + (nuevo ? 'Crear artículo' : 'Guardar cambios') + '</button></div></div>';
}

function erroresArt(f) {
  const e = {};
  const nombre = f.nombre.trim();
  if (!nombre) e.nombre = 'Escribe el nombre.';
  else {
    const dup = modelo().lista.find(function(a) { return a.id !== f.id && sinTildes(a.nombre) === sinTildes(nombre); });
    if (dup) e.nombre = 'Ya existe un artículo con ese nombre.';
  }
  if (!f.categoria || (f.categoria === '__otra' && !f.otra.trim())) e.categoria = 'Elige o escribe la categoría.';
  if (!f.id && f.inicial.trim() !== '' && !(num(f.inicial) >= 0)) e.inicial = 'Debe ser un número.';
  if (f.minimo.trim() !== '' && !(num(f.minimo) >= 0)) e.minimo = 'Debe ser un número.';
  return e;
}

function guardarArt() {
  const f = S.artForm;
  const e = erroresArt(f);
  if (Object.keys(e).length) {
    f.intentado = true;
    const y = window.scrollY; render(); window.scrollTo(0, y);
    return;
  }
  const id = f.id || nuevoId('A');
  const a = { id: id, nombre: f.nombre.trim(), categoria: f.categoria === '__otra' ? f.otra.trim() : f.categoria,
    unidad: f.unidad, inicial: f.id ? undefined : (num(f.inicial) || 0),
    minimo: f.minimo.trim() === '' ? null : num(f.minimo) };
  encolar('articulo', { a: a });
  S.artForm = null;
  toast(f.id ? 'Cambios guardados' : 'Artículo creado');
  if (f.id) volver();
  else { pila.pop(); pila.push('#/item/' + id); location.replace('#/item/' + id); }
  sincronizar();
}


/***********************
 * HOJAS INFERIORES (ventanas)
 ***********************/

let alCerrarHoja = null;

function abrirHoja(titulo, cuerpo, pie, alCerrar) {
  alCerrarHoja = alCerrar || null;
  $('capaModal').innerHTML = '<div class="velo" data-a="fondoHoja">' +
    '<div class="hoja" role="dialog" aria-modal="true" aria-labelledby="hojaTitulo">' +
      '<div class="agarre"></div>' +
      '<div class="h-cab"><h2 id="hojaTitulo">' + esc(titulo) + '</h2>' +
        '<button data-a="cerrarHoja" aria-label="Cerrar">' + ico('cerrar') + '</button></div>' +
      '<div class="h-cuerpo">' + cuerpo + '</div>' +
      (pie ? '<div class="h-pie">' + pie + '</div>' : '') +
    '</div></div>';
  document.body.style.overflow = 'hidden';
  const foco = $('capaModal').querySelector('[autofocus]') || $('capaModal').querySelector('.h-cab button');
  if (foco) foco.focus();
}

function cerrarHoja() {
  if (!$('capaModal').innerHTML) return;
  $('capaModal').innerHTML = '';
  document.body.style.overflow = '';
  const f = alCerrarHoja; alCerrarHoja = null;
  if (f) f();
}

function confirmar(o) {
  abrirHoja(o.titulo, '<p>' + o.texto + '</p>' + (o.extra || ''),
    '<button class="btn sec" data-a="cerrarHoja">Cancelar</button>' +
    '<button class="btn ' + (o.clase || '') + '" data-a="confirmarSi">' + esc(o.boton) + '</button>');
  S.alConfirmar = o.si;
}

function hojaOpciones() {
  const n = S.cola.length;
  abrirHoja('Opciones',
    '<div>' +
      '<button class="menu-op" data-a="ir" data-x="#/articulo/nuevo">' + ico('mas') + '<span>Nuevo artículo<small>Agregar material que no está en la lista</small></span></button>' +
      '<button class="menu-op" data-a="ir" data-x="#/minimos">' + ico('ajustes') + '<span>Definir stock mínimo<small>Todos los artículos en una sola pantalla</small></span></button>' +
      '<button class="menu-op" data-a="actualizar">' + ico('recargar') + '<span>Actualizar ahora<small>' + (n ? plural(n, 'cambio', 'cambios') + ' por subir' : 'Descargar lo último del servidor') + '</small></span></button>' +
      (S.instalar ? '<button class="menu-op" data-a="instalar">' + ico('instalar') + '<span>Instalar la app<small>Queda como ícono en el celular</small></span></button>' : '') +
      '<button class="menu-op" data-a="salir">' + ico('salir') + '<span>Salir en este celular<small>Pide el código de nuevo al entrar</small></span></button>' +
    '</div><p class="ayuda">Versión 1 · ' + plural(modelo().lista.length, 'artículo', 'artículos') + '</p>');
}

function hojaGrupo(id) {
  const m = modelo();
  const g = m.grupos.get(id);
  if (!g) return;
  const filas = g.items.map(function(it) {
    const a = m.arts.get(it.art);
    return '<button class="elegir" data-a="ir" data-x="#/item/' + esc(it.art) + '">' +
      '<span class="txt"><span class="nom" style="display:block">' + esc(a ? a.nombre : it.art) + '</span></span>' +
      '<span class="cant" style="font-size:16px' + (it.cant > 0 ? ';color:var(--ok-txt)' : '') + '">' + (it.cant > 0 ? '+' : '−') + fmt(Math.abs(it.cant)) + ' <small>' + (a ? uni(a.unidad) : '') + '</small></span></button>';
  }).join('');
  const origen = g.origen ? m.grupos.get(g.origen) : null;

  let ficha = '<dl class="ficha">' +
    '<dt>Fecha</dt><dd>' + esc(fechaTxt(g.fecha, !!g.fecha)) + '</dd>' +
    '<dt>' + etiquetaDestino(g.tipo) + '</dt><dd>' + esc(g.destino) + '</dd>' +
    (g.ticket ? '<dt>' + etiquetaTicket(g.tipo) + '</dt><dd>' + esc(g.ticket) + '</dd>' : '') +
    '<dt>Técnicos</dt><dd>' + esc(g.tecnicos) + '</dd>' +
    '<dt>Estado</dt><dd>' + tagGrupo(g) + (g.local ? ' <span class="tag bajo">' + ico('nube', 's') + 'Por subir</span>' : '') + '</dd>' +
    (g.cierre && g.estado !== 'Por instalar' && g.tipo === 'Retiro' ? '<dt>Cerrado</dt><dd>' + esc(fechaTxt(g.cierre, true)) + '</dd>' : '') +
    (g.obs ? '<dt>Observación</dt><dd>' + esc(g.obs) + '</dd>' : '') +
    (origen ? '<dt>Viene de</dt><dd><button class="agregar" data-a="grupo" data-x="' + esc(origen.id) + '">' + esc((origen.ticket ? 'Ticket ' + origen.ticket + ' · ' : '') + origen.destino) + '</button></dd>' : '') +
  '</dl>';

  const devoluciones = Array.from(m.grupos.values()).filter(function(x) { return x.origen === g.id && x.estado !== 'Anulado'; });
  if (devoluciones.length) {
    ficha += '<div class="aviso info">' + ico('vuelve') + '<span>Tiene ' + plural(devoluciones.length, 'devolución', 'devoluciones') + ' de sobrante.</span></div>';
  }

  let pie = '';
  if (g.estado === 'Por instalar') {
    pie = '<button class="btn sec chico" data-a="ir" data-x="#/mov?origen=' + esc(g.id) + '">Devolver sobrante</button>' +
      '<button class="btn verde chico" data-a="instalado" data-x="' + esc(g.id) + '">' + ico('check', 'm') + 'Instalado</button>';
  }
  const anular = g.estado !== 'Anulado'
    ? '<button class="btn peligro chico ancho" data-a="anular" data-x="' + esc(g.id) + '">' + ico('basura', 'm') + 'Anular este movimiento</button>' : '';

  abrirHoja(g.tipo + (g.ticket && g.tipo !== 'Ingreso' ? ' · ticket ' + g.ticket : ''),
    ficha + '<div class="tarjeta" style="padding:0 14px">' + filas + '</div>' + anular, pie);
}

function hojaElegirArt() {
  const f = S.form;
  abrirHoja('Agregar artículo',
    '<label class="buscar" style="border:1.5px solid var(--linea)">' + ico('buscar') +
      '<input id="buscaElegir" type="search" placeholder="Buscar artículo" aria-label="Buscar artículo" autocomplete="off" autofocus></label>' +
    '<div id="listaElegir">' + htmlElegir('') + '</div>');
  S.elegirTipo = f.tipo;
}

function htmlElegir(busqueda) {
  const f = S.form;
  const lista = modelo().lista.filter(function(a) { return !busqueda || coincide(a.nombre + ' ' + a.categoria, busqueda); });
  if (!lista.length) return '<p class="ayuda">Nada coincide. Si es material nuevo, créalo desde Opciones › Nuevo artículo.</p>';
  return lista.map(function(a) {
    const ya = f.items.some(function(x) { return x.id === a.id; });
    const bloqueado = f.tipo === 'Retiro' && a.stock <= 0;
    return '<button class="elegir" data-a="agregarLinea" data-x="' + esc(a.id) + '"' + (bloqueado || ya ? ' disabled' : '') + '>' +
      '<span class="foto-mini" style="width:40px;height:40px">' + (a.miniatura ? '<img src="' + esc(a.miniatura) + '" alt="">' : ico('camara', 'm')) + '</span>' +
      '<span class="txt"><span class="nom" style="display:block">' + esc(a.nombre) + '</span>' +
      '<span class="sub">' + (ya ? 'Ya está en la lista' : (bloqueado ? 'Agotado' : 'Hay ' + fmt(a.stock) + ' ' + uni(a.unidad))) + '</span></span></button>';
  }).join('');
}

function hojaMinimo(id) {
  const a = modelo().arts.get(id);
  abrirHoja('Stock mínimo',
    '<p><b>' + esc(a.nombre) + '</b><br><span class="ayuda">Hay ' + fmt(a.stock) + ' ' + uni(a.unidad) + '. Cuando baje de este número se marca "Bajo". Vacío = sin mínimo.</span></p>' +
    '<div class="campo"><label class="lbl" for="hMin">Mínimo en ' + (uni(a.unidad) === 'm' ? 'metros' : 'unidades') + '</label>' +
    '<input class="inp" id="hMin" inputmode="decimal" value="' + (a.minimo > 0 ? esc(a.minimo) : '') + '" autofocus>' +
    '<div class="error" id="errHMin" role="alert"></div></div>',
    '<button class="btn sec" data-a="cerrarHoja">Cancelar</button><button class="btn" data-a="guardarMinimo" data-x="' + esc(id) + '">Guardar</button>');
}


/***********************
 * FOTOS
 ***********************/

function cargarImagen(archivo) {
  return new Promise(function(resolve, reject) {
    const url = URL.createObjectURL(archivo);
    const img = new Image();
    img.onload = function() { resolve({ img: img, url: url }); };
    img.onerror = function() { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la foto.')); };
    img.src = url;
  });
}

function dibujar(img, lado, calidad, cuadrado) {
  const w = img.naturalWidth, h = img.naturalHeight;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  if (cuadrado) {
    const s = Math.min(w, h);
    c.width = c.height = Math.min(lado, s);
    ctx.drawImage(img, (w - s) / 2, (h - s) / 2, s, s, 0, 0, c.width, c.height);
  } else {
    const k = Math.min(1, lado / Math.max(w, h));
    c.width = Math.round(w * k); c.height = Math.round(h * k);
    ctx.drawImage(img, 0, 0, c.width, c.height);
  }
  return c.toDataURL('image/jpeg', calidad);
}

async function fotoElegida(archivo) {
  const id = S.fotoPara;
  if (!archivo || !id) return;
  try {
    toast('Procesando foto…', 'camara');
    const r = await cargarImagen(archivo);
    const grande = dibujar(r.img, 1280, 0.8, false);
    let mini = '';
    const pruebas = [[480, 0.72], [400, 0.68], [320, 0.62], [260, 0.55], [200, 0.5]];
    for (let i = 0; i < pruebas.length; i++) {
      mini = dibujar(r.img, pruebas[i][0], pruebas[i][1], true);
      if (mini.length < 45000) break;
    }
    URL.revokeObjectURL(r.url);
    // Si ya había una foto sin subir de este artículo, se reemplaza
    S.cola = S.cola.filter(function(op) { return !(op.accion === 'foto' && op.payload.id === id); });
    encolar('foto', { id: id, imagen: grande.split(',')[1], miniatura: mini });
    render();
    toast('Foto guardada' + (navigator.onLine ? '' : ' · se sube al volver la señal'));
    sincronizar();
  } catch (e) {
    toast(e.message, 'alerta');
  }
}


/***********************
 * COLA Y SINCRONIZACIÓN
 ***********************/

function encolar(accion, payload) {
  S.cola.push({ uid: nuevoId('O'), accion: accion, payload: payload, creado: new Date().toISOString() });
  cambio();
  guardarDato('cola', S.cola);
}

async function traerDatos() {
  const r = await llamar('datos', {}, 60000);
  S.servidor = { articulos: r.articulos, movimientos: r.movimientos, tecnicos: r.tecnicos, momento: r.momento };
  await guardarDato('servidor', S.servidor);
  cambio();
}

function puedeRepintar() {
  const v = partes().ruta[0] || 'inventario';
  if (['mov', 'minimos', 'articulo'].indexOf(v) >= 0) return false;
  if ($('capaModal').innerHTML) return false;
  const act = document.activeElement;
  return !(act && (act.tagName === 'INPUT' || act.tagName === 'TEXTAREA') && $('vista').contains(act));
}

async function sincronizar() {
  if (S.sincronizando || !codigoAcceso() || !urlConfigurada()) { pintarFranja(); return; }
  S.sincronizando = true;
  S.sync = { estado: 'sube', msg: '' };
  pintarFranja();
  try {
    while (S.cola.length) {
      const op = S.cola[0];
      await llamar(op.accion, op.payload, 90000);
      S.cola.shift();
      await guardarDato('cola', S.cola);
      pintarFranja();
    }
    await traerDatos();
    S.sync = { estado: 'ok', msg: '' };
  } catch (e) {
    if (e.sinRed) S.sync = { estado: 'sinred', msg: '' };
    else if (e.codigo === 'ACCESO') { S.sync = { estado: '', msg: '' }; accesoRechazado(e.message); }
    else S.sync = { estado: 'error', msg: e.message };
  } finally {
    S.sincronizando = false;
    cambio();
    if (puedeRepintar()) render(); else pintarFranja();
  }
}


/***********************
 * CÓDIGO DE ACCESO E INSTALACIÓN
 ***********************/

function mostrarAcceso(mensaje) {
  $('acceso').classList.remove('oculto');
  $('errorAcceso').innerHTML = mensaje ? ico('alerta', 's') + esc(mensaje) : '';
  $('codigoAcceso').value = '';
  setTimeout(function() { $('codigoAcceso').focus(); }, 50);
}

function accesoRechazado(mensaje) {
  try { localStorage.removeItem(CLAVE_CODIGO); } catch (e) { /* nada */ }
  mostrarAcceso(mensaje || 'El código cambió. Escribe el nuevo.');
}

async function validarAcceso(ev) {
  ev.preventDefault();
  const codigo = $('codigoAcceso').value.trim();
  const aviso = $('errorAcceso');
  if (!codigo) { aviso.innerHTML = ico('alerta', 's') + 'Escribe el código.'; return; }
  const btn = $('btnAcceso');
  btn.disabled = true;
  aviso.textContent = 'Comprobando…';
  try {
    await llamar('validar', {}, 30000, codigo);
    localStorage.setItem(CLAVE_CODIGO, codigo);
    $('acceso').classList.add('oculto');
    aviso.textContent = '';
    sincronizar();
  } catch (e) {
    aviso.innerHTML = ico('alerta', 's') + esc(e.sinRed ? 'No hay señal. El código se comprueba una sola vez y necesita conexión.' : e.message);
  } finally {
    btn.disabled = false;
  }
}

window.addEventListener('beforeinstallprompt', function(e) {
  e.preventDefault();
  S.instalar = e;
  if (puedeRepintar()) render();
});


/***********************
 * ACCIONES (toques en botones)
 ***********************/

const ACCIONES = {
  ir: function(x) { cerrarHoja(); ir(x); },
  tab: function(x) { irTab(x); },
  volver: function() { volver(); },
  opciones: hojaOpciones,
  cerrarHoja: cerrarHoja,
  fondoHoja: function(x, el, ev) { if (ev.target === el) cerrarHoja(); },
  confirmarSi: function() { const f = S.alConfirmar; S.alConfirmar = null; cerrarHoja(); if (f) f(); },
  filtro: function(x) { S.filtro = x; render(); },
  limpiarBusqueda: function() { S.busqueda = ''; render(); $('busqueda').focus(); },
  filtroHist: function(x) { S.hist.filtro = x; render(); },
  grupo: function(x) { cerrarHoja(); hojaGrupo(x); },
  foto: function(x) { S.fotoPara = x; $('archivoFoto').value = ''; $('archivoFoto').click(); },
  editarMinimo: hojaMinimo,
  guardarMinimo: function(x) {
    const t = $('hMin').value.trim();
    const v = t === '' ? null : num(t);
    if (t !== '' && !(v >= 0)) { $('errHMin').innerHTML = ico('alerta', 's') + 'Debe ser un número.'; return; }
    const valores = {}; valores[x] = v || null;
    encolar('minimos', { valores: valores });
    cerrarHoja(); render(); toast('Mínimo guardado'); sincronizar();
  },
  guardarMinimos: guardarMinimos,
  actualizar: function() { cerrarHoja(); sincronizar(); },
  reintentar: function() { S.sync = { estado: '', msg: '' }; sincronizar(); },
  descartarOp: function() {
    const op = S.cola[0];
    if (!op) return;
    confirmar({ titulo: '¿Descartar este cambio?', clase: 'peligro',
      texto: 'El servidor no acepta el cambio pendiente (' + esc(op.accion) + '): ' + esc(S.sync.msg) +
        '. Si lo descartas no se guardará en la hoja.', boton: 'Descartar',
      si: function() {
        S.cola.shift(); guardarDato('cola', S.cola); cambio();
        S.sync = { estado: '', msg: '' }; render(); sincronizar();
      } });
  },
  instalar: function() {
    cerrarHoja();
    if (!S.instalar) return;
    S.instalar.prompt();
    S.instalar.userChoice.finally(function() { S.instalar = null; render(); });
  },
  salir: function() {
    if (S.cola.length) {
      confirmar({ titulo: 'Hay cambios sin subir', texto: 'Sube los cambios antes de salir, o se perderán si borras los datos del navegador. Igual puedes salir: se quedan guardados en este celular.', boton: 'Salir igual', si: salirYa });
    } else {
      confirmar({ titulo: '¿Salir en este celular?', texto: 'Para volver a entrar hará falta el código de acceso y señal.', boton: 'Salir', si: salirYa });
    }
  },
  instalado: function(x) {
    const g = modelo().grupos.get(x);
    if (!g) return;
    confirmar({ titulo: '¿Marcar como instalado?', clase: 'verde', boton: 'Sí, instalado',
      texto: '<b>' + esc((g.ticket ? 'Ticket ' + g.ticket + ' · ' : '') + g.destino) + '</b>. El material ya salió del inventario; esto solo cierra el pendiente.',
      si: function() { encolar('estado', { grupo: x, estado: 'Instalado' }); render(); toast('Marcado como instalado'); sincronizar(); } });
  },
  anular: function(x) {
    const g = modelo().grupos.get(x);
    const sinSubir = S.cola.find(function(op) { return op.accion === 'registrar' && op.payload.g.id === x; });
    if (sinSubir) {
      confirmar({ titulo: '¿Borrar este movimiento?', clase: 'peligro', boton: 'Borrar',
        texto: 'Todavía no se ha subido, así que se borra de este celular y el stock vuelve a como estaba.',
        si: function() {
          S.cola = S.cola.filter(function(op) {
            return op !== sinSubir && !(op.accion === 'estado' && op.payload.grupo === x);
          });
          guardarDato('cola', S.cola); cambio(); render(); toast('Movimiento borrado');
        } });
      return;
    }
    confirmar({ titulo: '¿Anular este movimiento?', clase: 'peligro', boton: 'Anular',
      texto: esc(g.tipo + (g.ticket ? ' · ticket ' + g.ticket : '') + ' · ' + g.destino) +
        '. Las cantidades dejan de contar en el stock. Queda en el historial como anulado.',
      extra: '<div class="campo"><label class="lbl" for="motivoAnular">Motivo</label>' +
        '<input class="inp" id="motivoAnular" placeholder="Ej: se registró dos veces"><div class="error" id="errMotivo" role="alert"></div></div>',
      si: null });
    S.alConfirmar = null;
    // El motivo es obligatorio: se revisa antes de cerrar
    const btn = $('capaModal').querySelector('[data-a="confirmarSi"]');
    btn.setAttribute('data-a', 'anularSi');
    btn.setAttribute('data-x', x);
  },
  anularSi: function(x) {
    const motivo = $('motivoAnular').value.trim();
    if (!motivo) { $('errMotivo').innerHTML = ico('alerta', 's') + 'Escribe el motivo.'; $('motivoAnular').focus(); return; }
    encolar('estado', { grupo: x, estado: 'Anulado', motivo: motivo });
    cerrarHoja(); render(); toast('Movimiento anulado'); sincronizar();
  },

  // Formulario de movimiento
  tipo: function(x) { S.form.tipo = x; if (x !== 'Retiro') S.form.sinTicket = false; guardarBorrador(); repintarMov(); },
  tecnico: function(x) {
    const t = S.form.tecnicos; const i = t.indexOf(x);
    if (i >= 0) t.splice(i, 1); else t.push(x);
    guardarBorrador(); repintarMov();
  },
  estadoForm: function(x) { S.form.estado = x; guardarBorrador(); repintarMov(); },
  elegirArt: hojaElegirArt,
  agregarLinea: function(x) {
    S.form.items.push({ id: x, q: 1 });
    guardarBorrador(); cerrarHoja(); repintarMov();
  },
  quitarLinea: function(x) { S.form.items.splice(Number(x), 1); guardarBorrador(); repintarMov(); },
  paso: function(x, el) {
    const it = S.form.items[Number(x)];
    const d = Number(el.getAttribute('data-d'));
    const v = Math.max(0, (num(it.q) || 0) + d);
    it.q = String(Math.round(v * 100) / 100);
    guardarBorrador();
    const inp = document.querySelector('[data-campo="q"][data-i="' + x + '"]');
    if (inp) inp.value = it.q;
    refrescarLinea(Number(x)); refrescarErroresMov();
  },
  guardarMov: guardarMov,
  cancelarMov: function() {
    if (formVacio(S.form)) { S.form = null; ls('ig_borrador', null); volver(); return; }
    confirmar({ titulo: '¿Descartar este movimiento?', clase: 'peligro', boton: 'Descartar',
      texto: 'Se pierde lo que llevas escrito.',
      si: function() { S.form = null; ls('ig_borrador', null); volver(); } });
  },
  borradorNuevo: function() {
    S.form = S.borradorNuevo; S.borradorNuevo = null;
    guardarBorrador(); cerrarHoja(); repintarMov();
  },

  // Formulario de artículo
  artCat: function(x) { S.artForm.categoria = x; render(); },
  artUni: function(x) { S.artForm.unidad = x; render(); },
  guardarArt: guardarArt
};

function salirYa() {
  try { localStorage.removeItem(CLAVE_CODIGO); } catch (e) { /* nada */ }
  mostrarAcceso('');
}

document.addEventListener('click', function(ev) {
  const el = ev.target.closest('[data-a]');
  if (!el || el.disabled) return;
  const f = ACCIONES[el.getAttribute('data-a')];
  if (!f) return;
  if (el.tagName === 'A' && el.getAttribute('href') && el.getAttribute('data-a') !== 'ir') return;
  f(el.getAttribute('data-x'), el, ev);
});

document.addEventListener('input', function(ev) {
  const el = ev.target;
  if (el.id === 'busqueda') { S.busqueda = el.value; pintarListaArt(); return; }
  if (el.id === 'busquedaHist') { S.hist.busqueda = el.value; $('listaHist').innerHTML = htmlListaHist(); return; }
  if (el.id === 'buscaElegir') { $('listaElegir').innerHTML = htmlElegir(el.value); return; }

  const campo = el.getAttribute('data-campo');
  if (campo && S.form) {
    if (campo === 'q') {
      S.form.items[Number(el.getAttribute('data-i'))].q = el.value;
      refrescarLinea(Number(el.getAttribute('data-i')));
    } else if (campo === 'destino') {
      const pos = el.selectionStart;
      el.value = el.value.toUpperCase();
      try { el.setSelectionRange(pos, pos); } catch (e) { /* nada */ }
      S.form.destino = el.value;
    } else if (campo === 'sinTicket' || campo === 'cerrarOrigen') {
      S.form[campo] = el.checked;
      if (campo === 'sinTicket') { guardarBorrador(); repintarMov(); return; }
    } else {
      S.form[campo] = el.value;
    }
    guardarBorrador();
    refrescarErroresMov();
    return;
  }
  const art = el.getAttribute('data-art');
  if (art && S.artForm) {
    S.artForm[art] = el.value;
    if (S.artForm.intentado) {
      const e = erroresArt(S.artForm);
      [['err-aNombre', e.nombre], ['err-aCat', e.categoria], ['err-aInicial', e.inicial], ['err-aMinimo', e.minimo]].forEach(function(x) {
        const d = $(x[0]);
        if (d) d.innerHTML = x[1] ? ico('alerta', 's') + esc(x[1]) : '';
      });
    }
  }
});

document.addEventListener('change', function(ev) {
  if (ev.target.id === 'archivoFoto') fotoElegida(ev.target.files && ev.target.files[0]);
});

document.addEventListener('keydown', function(ev) {
  if (ev.key === 'Escape' && $('capaModal').innerHTML) cerrarHoja();
});

$('formAcceso').addEventListener('submit', validarAcceso);


/***********************
 * ARRANQUE
 ***********************/

async function iniciar() {
  try { await abrirBD(); } catch (e) { /* sin almacén: funciona solo con señal */ }
  const guardado = await leerDato('servidor');
  if (guardado && guardado.articulos) S.servidor = guardado;
  S.cola = (await leerDato('cola')) || [];
  S.form = ls('ig_borrador');
  cambio();

  pila = [rutaActual()];
  render();

  if (!urlConfigurada()) {
    S.sync = { estado: 'error', msg: 'falta pegar la URL de Apps Script en config.js' };
    pintarFranja();
    return;
  }
  if (!codigoAcceso()) mostrarAcceso('');
  else sincronizar();

  window.addEventListener('online', sincronizar);
  window.addEventListener('offline', pintarFranja);
  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'visible') sincronizar();
  });
  setInterval(function() {
    if (document.visibilityState === 'visible') sincronizar();
  }, 180000);
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', function() {
    navigator.serviceWorker.register('sw.js').catch(function() { /* sin modo sin señal */ });
  });
}

iniciar();
