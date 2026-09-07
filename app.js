'use strict';
/* TerrApp B2 — PWA cliente.
   Habla con el Apps Script Web App por HTTPS. NO lleva credenciales:
   sólo la URL pública del backend. */

// ==== CONFIG ====
const BACKEND_URL = 'https://script.google.com/macros/s/AKfycbw3snjl4xousmjRGj9Fvwg2U1zXL-Exnhxam7TIrxRscW75fbf3FC77ooRyZyV-U3TxmA/exec';

const TIPOS = ['Perfil cuadrado','Perfil rectangular','Perfil canal','Plancha','Angulo plegado',
  'Angulo laminado','Viga UPN','Viga IPE','Viga IPN','Viga HEA','Viga HEB','Viga WF','Viga I',
  'Viga H','Cañería','Redondo','Costanera','Pletina','Bobina','Perfil Especial','Otro'];
const GRADOS = ['SAE1020','S275jr','A36','A572','A653','A992','A242','A588','A502','A709','A792',
  'A913','270ES','345ES','A53','A106','Q355','Q235','otro'];

// ==== estado ====
const S = {
  inspector:null, pin:null,
  header:{ ar:'', ote:'', ram:'', fecha:'', sedeId:'' },
  coladas:[], editIndex:-1,
  cliEditId:null, pesoTouched:false, std:false
};
// n° de muestras por colada (espejo del backend)
function nMuestras(kg, identificada){
  const div = identificada ? 40000 : 20000;
  const cap = identificada ? 5 : 10;
  let n = Math.ceil(num(kg) / div);
  if (!isFinite(n) || n < 1) n = 1;
  return Math.min(cap, n);
}
const $ = s => document.querySelector(s);
const VIEWS = ['viewLogin','viewMenu','viewHeader','viewSamples','viewResult','viewClientes'];
function show(id){ VIEWS.forEach(v => $('#'+v).hidden = (v!==id)); window.scrollTo(0,0); }

// ==== arranque ====
document.addEventListener('DOMContentLoaded', () => {
  initSelects();
  fetch('data/pesos.json').then(r => r.json()).then(d => { PESOS = d; }).catch(()=>{});
  $('#inFecha').value = todayISO();
  $('#inAr').addEventListener('blur', e => {
    const v = e.target.value.trim().replace(/\D/g,'');
    if (v) e.target.value = v.padStart(4,'0').slice(-4);
  });
  $('#selTipo').addEventListener('change', () => { updateStdBtn(); recalcPeso(); });
  $('#selGrado').addEventListener('change', applyGradoColor);
  $('#chkId').addEventListener('change', () => { toggleIdLabel(); marcoIdent(); updateMuestrasPrev(); });
  $('#dlgSample').addEventListener('close', () => document.body.classList.remove('ident-on'));
  $('#btnStd').addEventListener('click', toggleStd);
  $('#formSample').dimension.addEventListener('input', recalcPeso);
  $('#formSample').dimension.addEventListener('blur', stdCompleta);
  $('#formSample').cantidad.addEventListener('input', recalcPeso);
  $('#formSample').peso.addEventListener('input', () => {
    const p = $('#formSample').peso;
    S.pesoTouched = p.value.trim() !== '';
    p.classList.toggle('peso-calc', !S.pesoTouched);
    if (!S.pesoTouched) recalcPeso();
    updateMuestrasPrev();
  });
  $('#formSample').pos.addEventListener('blur', e => {
    const v = e.target.value.trim().replace(/\D/g,'');
    if (v) e.target.value = v.padStart(2,'0').slice(-2);
    updateMuestrasPrev();
  });

  const saved = sessionStorage.getItem('terrapp.session');
  if (saved){ Object.assign(S, JSON.parse(saved)); enterApp(); }
  else show('viewLogin');

  $('#btnLogin').onclick      = doLogin;
  $('#btnSalir').onclick      = doLogout;
  $('#btnMenuInsp').onclick   = () => { resetInspeccion(); show('viewHeader'); };
  $('#btnMenuCli').onclick    = openClientes;
  $('#btnBackMenu1').onclick  = () => show('viewMenu');
  $('#btnBackMenu2').onclick  = () => show('viewMenu');
  $('#btnBuscarOte').onclick  = buscarOte;
  $('#btnAMuestras').onclick  = goSamples;
  $('#btnBackHeader').onclick = () => show('viewHeader');
  $('#btnAddSample').onclick  = () => openColada(-1);
  $('#btnOrdenar').onclick    = ordenarColadas;
  $('#verCerrar').onclick     = () => $('#dlgVer').close();
  $('#btnGenerar').onclick    = generar;
  $('#btnNueva').onclick      = () => { resetInspeccion(); show('viewHeader'); };
  $('#formSample').addEventListener('submit', onSampleSubmit);
  $('#formOte').addEventListener('submit', onOteSubmit);
  $('#btnCliNueva').onclick   = () => openOte(null);
  $('#cliQ').addEventListener('input', debounce(() => cargarClientes($('#cliQ').value), 300));

  window.addEventListener('online',  () => { $('#offline').hidden = true; flushQueue(); });
  window.addEventListener('offline', () => { $('#offline').hidden = false; });
  $('#offline').hidden = navigator.onLine;
  flushQueue();

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});
});

// ==== helpers ====
function initSelects(){
  $('#selTipo').innerHTML  = TIPOS.map(t => `<option${t==='Plancha'?' selected':''}>${t}</option>`).join('');
  $('#selGrado').innerHTML = GRADOS.map(g => `<option${g==='A36'?' selected':''}>${g}</option>`).join('');
  updateStdBtn(); applyGradoColor();
}
function gradoColor(g){
  g = String(g||'').toUpperCase();
  if (g === 'A36') return '#1d4ed8';                 // azul
  if (g === 'A572' || g === 'A572 GR50') return '#dc2626'; // rojo
  return '#c026d3';                                  // fucsia
}
function applyGradoColor(){
  const s = $('#selGrado'); if (!s) return;
  s.style.color = gradoColor(s.value);
  s.style.fontWeight = '700';
}
const STD_SUFIJO = 'x2440x12000';
const STD_MSG = 'error, ingrese sólo el espesor. [Std] autocompleta a dimensiones estandar de ' + STD_SUFIJO.slice(1);

// Muestra/oculta el botón Std según el tipo; si no es Plancha lo apaga.
function updateStdBtn(){
  const btn = $('#btnStd'); if (!btn) return;
  const esPlancha = $('#selTipo').value === 'Plancha';
  btn.hidden = !esPlancha;
  if (!esPlancha && S.std){ S.std = false; aplicaEstiloStd(); }
}
function aplicaEstiloStd(){
  const btn = $('#btnStd'), dim = $('#formSample').dimension, hint = $('#dimHint');
  if (btn) btn.classList.toggle('std-on', !!S.std);
  if (dim) dim.classList.toggle('dim-std', !!S.std);
  if (hint) hint.textContent = S.std ? 'ingresa sólo el espesor → ' + STD_SUFIJO.slice(1) : '';
}
function toggleStd(){
  S.std = !S.std;
  aplicaEstiloStd();
  if (S.std) stdCompleta();          // si ya hay un número solo, completarlo
}
// Completa "50" -> "50x2440x12000". Alerta si hay una x que no sea el patrón estándar.
function stdCompleta(){
  if (!S.std) return;
  const dim = $('#formSample').dimension;
  const v = dim.value.trim().replace(/\s/g,'').replace(',', '.');
  if (!v) return;
  if (/^\d+(\.\d+)?$/.test(v)){                       // sólo el espesor
    dim.value = v + STD_SUFIJO;
    recalcPeso();
  } else if (/^\d+(\.\d+)?x2440x12000$/i.test(v)){    // ya completado, ok
    dim.value = v;
  } else {                                            // tiene x y no es el patrón
    alert(STD_MSG);
  }
}

// Tablas de peso (Kg+ portado). Se cargan de data/pesos.json al inicio.
let PESOS = null;
const DENS = 7.85e-6;   // kg/mm³ (acero)

const DENS_L = 7.85e-3;   // kg por (mm²·m) para perfiles lineales. Kg+ usaba 7,5; 7,85 calza con las tablas.

function dimsNum(dim){
  return String(dim||'').split(/[x×*\s]+/)
    .map(s => parseFloat(String(s).replace(',','.'))).filter(v => isFinite(v));
}
function pick(a,b){ return (a === undefined || a === null) ? b : a; }

// -> { kg, via } o null.  El largo va SIEMPRE al final de "dim" (en mm).
function pesoColada(tipo, dim, cant, grado){
  const N = dimsNum(dim), q = num(cant);
  if (!q || N.length < 2) return null;
  const L = N[N.length-1] / 1000;          // largo en m
  const s = N.slice(0, -1);                // números de sección
  const g = String(grado||'').toUpperCase();
  const T = (PESOS && PESOS.lineales) || {};
  const lin  = (tab,key) => (T[tab]||{})[String(key).toLowerCase()];
  const lin2 = (tab,a,b,e) => {            // clave AxBxeE tolerante a orden de a,b
    const lo = Math.min(a,b), hi = Math.max(a,b);
    return pick(lin(tab,`${lo}x${hi}e${e}`), lin(tab,`${hi}x${lo}e${e}`));
  };
  const done = (kg,via) => (kg != null && isFinite(kg) && kg > 0) ? { kg, via } : null;
  // fórmula de plegado (Kg+): x = perímetro − 1,6·e·vértices ;  kg = x·e·L·q·7,85e-3
  const plegado = (perim,vert,e) => (perim - 1.6*e*vert) * e * L * q * DENS_L;

  switch (tipo){
    case 'Plancha':
    case 'Pletina':
      if (N.length < 3) return null;
      return done(N[0]*N[1]*N[2]*q*DENS, 'fórmula');

    case 'Perfil rectangular': {
      if (s.length < 3) return null;
      const [a,b,e] = s, t = lin2('rectangular',a,b,e);
      return t != null ? done(t*L*q,'tabla') : done(plegado(2*a+2*b,4,e),'plegado');
    }
    case 'Perfil cuadrado': {
      if (s.length < 2) return null;
      const [a,e] = s, t = lin('cuadrado',`${a}x${e}`);
      return t != null ? done(t*L*q,'tabla') : done(plegado(4*a,4,e),'plegado');
    }
    case 'Perfil canal': {
      if (s.length < 3) return null;
      let [a,b,e] = s; if (b > a){ const x=a; a=b; b=x; }   // b = lado corto
      const t = lin2('canal',a,b,e);
      return t != null ? done(t*L*q,'tabla') : done(plegado(a+2*b,2,e),'plegado');
    }
    case 'Costanera': {
      let sc = s;
      if (sc.length === 4 && sc[2] === 15) sc = [sc[0],sc[1],sc[3]];  // pliegue 15 implícito
      if (sc.length < 3) return null;
      const t = lin2('costanera',sc[0],sc[1],sc[2]);
      return t != null ? done(t*L*q,'tabla') : null;                  // sin fórmula → blanco
    }
    case 'Angulo laminado': {
      if (s.length < 2) return null;
      const t = lin('angulo',`${s[0]}x${s[1]}`);
      return t != null ? done(t*L*q,'tabla') : null;                  // blanco
    }
    case 'Angulo plegado': {
      if (s.length < 2) return null;
      const e = s[s.length-1];
      const a = s[0], b = s.length >= 3 ? s[1] : s[0];
      return done(plegado(a+b,1,e),'plegado');
    }
    case 'Viga UPN': case 'Viga IPE': case 'Viga IPN': case 'Viga HEA': case 'Viga HEB': {
      const tab = { 'Viga UPN':'viga_upn','Viga IPE':'viga_ipe','Viga IPN':'viga_ipn',
                    'Viga HEA':'viga_hea','Viga HEB':'viga_heb' }[tipo];
      const t = lin(tab,`${s[0]}`);
      return t != null ? done(t*L*q,'tabla') : null;                  // blanco
    }
    case 'Viga WF': case 'Viga I': case 'viga H': {
      if (s.length < 2) return null;
      const key = `${s[0]}x${s[1]}`;
      const t = pick(lin('wf_i',key), lin('wf_h',key));
      return t != null ? done(t*L*q,'tabla') : null;                  // blanco
    }
    case 'Cañería': {
      if (s.length < 2) return null;
      if (g === 'A53' || g === 'A106'){
        const t = lin(g === 'A106' ? 'caneria_a106' : 'caneria_a53', `${s[0]}s${s[1]}`);
        return t != null ? done(t*L*q,'tabla') : null;               // tabla pobre → blanco
      }
      const de = s[0], di = s[1];                                     // Ø ext / Ø int (calculada)
      if (di == null || di >= de) return null;
      return done(Math.PI/4*(de*de - di*di) * L * q * DENS_L, 'anillo');
    }
    case 'Redondo':
      return done(Math.PI/4 * s[0]*s[0] * L * q * DENS_L, 'fórmula');

    default:
      return null;   // Bobina, Perfil Especial, Otro → manual
  }
}

function recalcPeso(){
  const f = $('#formSample'), note = $('#pesoCalcNote');
  const setNote = t => { if (note) note.textContent = t; };
  if (S.pesoTouched){ setNote(''); return; }
  const r = pesoColada(f.tipo.value, f.dimension.value, f.cantidad.value, f.grado.value);
  if (!r){ f.peso.value = ''; f.peso.classList.remove('peso-calc'); setNote(''); updateMuestrasPrev(); return; }
  f.peso.value = Math.round(r.kg);
  f.peso.classList.add('peso-calc');
  setNote('≈ ' + r.via + ' (editable)');
  updateMuestrasPrev();
}
function toggleIdLabel(){ const l = $('#idLabel'); if (l) l.classList.toggle('on', $('#chkId').checked); }
function marcoIdent(){ document.body.classList.toggle('ident-on', $('#chkId').checked); }
function pad2(x){ const v = String(x||'').replace(/\D/g,''); return v ? v.padStart(2,'0').slice(-2) : ''; }

// Lista de códigos de muestra AAAA-PP-nnTT de una colada
function muestrasDeColada(c, ar){
  const n = nMuestras(c.peso, c.identificada), pp = pad2(c.pos) || 'PP';
  const A = ar || S.header.ar || '####';
  const out = [];
  for (let k=1;k<=n;k++) out.push(`${A}-${pp}-${pad2(k)}${pad2(n)}`);
  return out;
}
function updateMuestrasPrev(){
  const f = $('#formSample'), p = $('#muestrasPrev');
  if (!p) return;
  const kg = num(f.peso.value);
  if (!kg){ p.textContent = ''; return; }
  const codes = muestrasDeColada({ peso:kg, identificada:f.identificado.checked, pos:f.pos.value });
  p.innerHTML = `→ <b>${codes.length}</b> muestra${codes.length>1?'s':''}: ${codes.join(', ')}`;
}

function todayISO(){ return new Date().toISOString().slice(0,10); }
function toCL(iso){ const [y,m,d] = iso.split('-'); return `${d}/${m}/${y}`; }
function num(x){ const n = parseFloat(String(x).replace(',','.')); return isFinite(n) ? n : 0; }
function round(n){ return Math.round(n*1000)/1000; }
function esc(s){ return String(s==null?'':s).replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c])); }
function debounce(fn,ms){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms); }; }

async function call(payload){
  const res = await fetch(BACKEND_URL, {
    method:'POST',
    headers:{ 'Content-Type':'text/plain;charset=utf-8' },   // evita el preflight CORS
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}
function offlineErr(e){ return e.message === 'offline' || /Failed to fetch|NetworkError/i.test(e.message); }
function withAuth(o){ return Object.assign({ inspector:S.inspector, pin:S.pin }, o); }

// ==== login ====
async function doLogin(){
  const insp = $('#inInspector').value, pin = $('#inPin').value.trim();
  const msg = $('#loginMsg'); msg.textContent = ''; msg.className = 'msg';
  if (!pin){ msg.textContent = 'Ingrese el PIN'; return; }
  $('#btnLogin').disabled = true;
  try{
    const r = await call({ accion:'ping', inspector:insp, pin });
    if (!r.ok) throw new Error(r.error || 'No autorizado');
    S.inspector = insp; S.pin = pin;
    sessionStorage.setItem('terrapp.session', JSON.stringify({ inspector:insp, pin }));
    enterApp();
  }catch(e){
    msg.textContent = offlineErr(e) ? 'Sin conexión con el servidor' : e.message;
  }finally{ $('#btnLogin').disabled = false; }
}
function enterApp(){
  $('#who').hidden = false; $('#who').textContent = S.inspector;
  $('#btnSalir').hidden = false;
  show('viewMenu');
}
function doLogout(){ sessionStorage.removeItem('terrapp.session'); location.reload(); }

// ==== cabecera de inspección ====
function resetInspeccion(){
  S.header = { ar:'', ote:'', ram:'', fecha:todayISO(), sedeId:'' };
  S.coladas = [];
  ['#inAr','#inOte','#inRam'].forEach(s => $(s).value = '');
  $('#inFecha').value = todayISO();
  $('#sedeBox').innerHTML = ''; $('#queuedMsg').hidden = true;
  $('#headerMsg').textContent = '';
}

let SEDES = [];   // filas del OTE buscado (acopladas: solicitante + dirección)

function sedeLabel(s){
  return [s.nombre || 's/nombre', s.sede || s.comuna || '', s.cliente]
    .filter(Boolean).join(' · ');
}
function sedeResumen(s){
  if (!s) return '';
  return `Solicitante: <b>${esc(s.nombre || '—')}</b> · ${esc(s.cliente || '')}` +
    `${s.sede ? ' · ' + esc(s.sede) : ''}${s.comuna ? ' · ' + esc(s.comuna) : ''}`;
}
function renderSedeOpts(filtro){
  const q = (filtro || '').trim().toLowerCase();
  const sel = $('#selSede'); if (!sel) return;
  let primeraVisible = null;
  Array.from(sel.options).forEach(o => {
    const s = SEDES.find(x => x.id === o.value);
    const txt = (s ? [s.nombre, s.sede, s.comuna, s.cliente].join(' ') : o.text).toLowerCase();
    const vis = !q || txt.indexOf(q) >= 0;
    o.hidden = !vis;
    if (vis && primeraVisible == null) primeraVisible = o.value;
  });
  const cur = SEDES.find(x => x.id === sel.value);
  const curTxt = cur ? [cur.nombre, cur.sede, cur.comuna, cur.cliente].join(' ').toLowerCase() : '';
  if (q && curTxt.indexOf(q) < 0 && primeraVisible) sel.value = primeraVisible;
  S.header.sedeId = sel.value;
  $('#sedeResumen').innerHTML = sedeResumen(SEDES.find(x => x.id === sel.value));
}

async function buscarOte(){
  const ote = $('#inOte').value.trim();
  const box = $('#sedeBox'); box.innerHTML = ''; S.header.sedeId = ''; SEDES = [];
  if (!ote) return;
  box.textContent = 'Buscando…';
  try{
    const r = await call(withAuth({ accion:'sedes', ote }));
    if (!r.ok) throw new Error(r.error || 'Error');
    SEDES = r.sedes || [];
    if (!SEDES.length){
      box.innerHTML = `<p class="hint fucsia">OTE sin registros. Agrégalo en <b>Clientes</b>.</p>`;
      return;
    }
    if (SEDES.length === 1){
      S.header.sedeId = SEDES[0].id;
      box.innerHTML = `<p class="hint azul">${sedeResumen(SEDES[0])}</p>`;
      return;
    }
    const opts = SEDES.map(s => `<option value="${esc(s.id)}">${esc(sedeLabel(s))}</option>`).join('');
    box.innerHTML =
      `<input id="sedeFiltro" type="search" placeholder="&gt;&gt;filtro x solicitante, lugar o cede&lt;&lt;">
       <label>Solicitante y ubicación
         <select id="selSede">${opts}</select>
       </label>
       <p class="hint azul" id="sedeResumen"></p>`;
    $('#selSede').addEventListener('change', () => renderSedeOpts($('#sedeFiltro').value));
    $('#sedeFiltro').addEventListener('input', () => renderSedeOpts($('#sedeFiltro').value));
    renderSedeOpts('');
  }catch(e){
    box.innerHTML = `<p class="hint">${offlineErr(e) ? 'Sin señal para consultar el OTE' : esc(e.message)}</p>`;
  }
}

function goSamples(){
  const msg = $('#headerMsg'); msg.textContent = '';
  const ar = $('#inAr').value.trim(), ote = $('#inOte').value.trim(),
        ram = $('#inRam').value.trim(), fecha = $('#inFecha').value;
  if (!/^\d{4}$/.test(ar)) return (msg.textContent = 'AR: 4 dígitos');
  if (!ote)   return (msg.textContent = 'Falta el OTE');
  if (!fecha) return (msg.textContent = 'Falta la fecha');
  if (!S.header.sedeId) return (msg.textContent = 'Presiona "Buscar" y elige el solicitante / ubicación');
  S.header.ar = ar; S.header.ote = ote; S.header.ram = ram; S.header.fecha = toCL(fecha);
  renderColadas(); show('viewSamples');
}

// ==== coladas ====
function coladasDesordenadas(){
  for (let i=1;i<S.coladas.length;i++)
    if (num(S.coladas[i].pos) < num(S.coladas[i-1].pos)) return true;
  return false;
}
function posDuplicados(){
  const vistos = new Set();
  for (const c of S.coladas){ if (vistos.has(c.pos)) return true; vistos.add(c.pos); }
  return false;
}
// las coladas ordenadas por pos deben ser exactamente 01,02,03,…,N
function correlativoOk(){
  const ps = S.coladas.map(c => num(c.pos)).sort((a,b) => a - b);
  return ps.length > 0 && ps.every((p,i) => p === i + 1);
}
function ordenarColadas(){
  S.coladas.sort((a,b) => num(a.pos) - num(b.pos));
  renderColadas();
}
function borrarColada(i){
  if (!confirm('Esta acción borrará todas las muestras de esta colada. ¿Continuar?')) return;
  S.coladas.splice(i,1); renderColadas();
}

function renderColadas(){
  const ul = $('#sampleList'); ul.innerHTML = '';
  let totM = 0, totKg = 0, totU = 0, prevPos = -Infinity;
  S.coladas.forEach((c,i) => {
    const codes = muestrasDeColada(c);
    const n = codes.length;
    totM += n; totKg += num(c.peso); totU += num(c.cantidad);
    const fuera = num(c.pos) < prevPos;
    prevPos = num(c.pos);
    const notacion = n>1 ? `${codes[0]} … ${codes[n-1]}` : codes[0];
    const li = document.createElement('li');
    if (c.identificada) li.className = 'ident';
    li.innerHTML = `<div class="body" data-v="${i}">
        <b class="col-lbl${fuera?' fuera':''}">Col. ${esc(c.pos)}</b> · ${esc(c.tipo)}
        <span style="color:${gradoColor(c.grado)};font-weight:700"> ${esc(c.grado||'')}</span>
        <span class="pill">${n} m</span>
        <div class="meta">${esc(c.dimension||'')} · Colada ${esc(c.colada||'—')}
          · ${num(c.cantidad)} u · ${num(c.peso)} kg · ${c.identificada ? '✔ Identificada' : 'No Id.'}</div>
        <div class="meta">${esc(notacion)}</div>
      </div>
      <div class="sbtns">
        <button class="secondary" data-e="${i}">Editar</button>
        <button class="del" data-d="${i}" title="Borrar colada">✕</button>
      </div>`;
    ul.appendChild(li);
  });
  ul.querySelectorAll('[data-v]').forEach(b => b.onclick = () => openVer(+b.dataset.v));
  ul.querySelectorAll('[data-e]').forEach(b => b.onclick = () => openColada(+b.dataset.e));
  ul.querySelectorAll('[data-d]').forEach(b => b.onclick = () => borrarColada(+b.dataset.d));
  $('#sampleCount').textContent = S.coladas.length;
  $('#totMuestras').textContent = totM;
  $('#totKg').textContent = round(totKg / 1000);   // Ton
  $('#totU').textContent  = totU;
  $('#btnOrdenar').hidden = !coladasDesordenadas();
}

function openVer(i){
  const c = S.coladas[i]; if (!c) return;
  const codes = muestrasDeColada(c).map(x => x.split('-').pop());   // sólo nnTT: 0103, 0203…
  $('#verTitle').textContent = 'Colada ' + c.pos;
  $('#verBody').innerHTML = [
    ['Muestras', esc(codes.join(', '))],
    ['Tipo', esc(c.tipo)],
    ['Dimensiones', esc(c.dimension || '—')],
    ['Grado', `<span style="color:${gradoColor(c.grado)}">${esc(c.grado||'—')}</span>`],
    ['Colada (hornada)', esc(c.colada || '—')],
    ['Unidades', num(c.cantidad)],
    ['Peso', num(c.peso) + ' kg'],
    ['Identificada', c.identificada ? '<span class="badge si">SÍ</span>' : '<span class="badge no">NO</span>']
  ].map(([k,v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  $('#verEditar').onclick = () => { $('#dlgVer').close(); openColada(i); };
  $('#dlgVer').showModal();
}
function openColada(i){
  S.editIndex = i;
  const f = $('#formSample'); f.reset();
  $('#dlgTitle').textContent = 'Datos Colada';
  const c = i>=0 ? S.coladas[i] : {};
  const maxPos = S.coladas.reduce((m,x) => Math.max(m, num(x.pos)), 0);
  f.pos.value       = c.pos || pad2(maxPos + 1);
  f.tipo.value      = c.tipo || 'Plancha';
  f.dimension.value = c.dimension || '';
  f.grado.value     = c.grado || 'A36';
  f.colada.value    = c.colada || '';
  f.cantidad.value  = c.cantidad || '';
  f.peso.value      = c.peso || '';
  f.identificado.checked = !!c.identificada;
  S.std = false;
  S.pesoTouched = (i >= 0 && !!c.peso);   // en edición se respeta el peso guardado
  f.peso.classList.toggle('peso-calc', !S.pesoTouched);
  updateStdBtn(); aplicaEstiloStd(); applyGradoColor(); toggleIdLabel(); marcoIdent();
  if (!S.pesoTouched) recalcPeso();
  updateMuestrasPrev();
  $('#dlgSample').showModal();
}
function onSampleSubmit(ev){
  if (ev.submitter && ev.submitter.value === 'cancel') return;
  const f = ev.target;
  if (S.std){
    const v = f.dimension.value.trim().replace(/\s/g,'').replace(',', '.');
    if (v && /x/i.test(v) && !/^\d+(\.\d+)?x2440x12000$/i.test(v)){
      ev.preventDefault(); alert(STD_MSG); return;
    }
    stdCompleta();
  }
  const c = {
    pos: pad2(f.pos.value),
    tipo:f.tipo.value.trim(), dimension:f.dimension.value.trim(),
    grado:f.grado.value.trim(), colada:f.colada.value.trim(),
    cantidad:f.cantidad.value.trim(), peso:f.peso.value.trim(),
    identificada:f.identificado.checked
  };
  if (!c.pos || !c.tipo || !num(c.peso)){
    ev.preventDefault(); alert('Pos. colada, Tipo y Peso son obligatorios'); return;
  }
  if (S.editIndex>=0) S.coladas[S.editIndex] = c; else S.coladas.push(c);
  renderColadas();
}

// ==== generar ====
async function generar(){
  const msg = $('#samplesMsg'); msg.textContent = ''; msg.className = 'msg';
  if (!S.coladas.length) return (msg.textContent = 'Agregue al menos una colada');
  if (!correlativoOk()){
    msg.textContent = 'Revisar correlativo de coladas';
    return;
  }
  const payload = withAuth({
    accion:'crear',
    ar:S.header.ar, ote:S.header.ote, ram:S.header.ram, fecha:S.header.fecha, sedeId:S.header.sedeId,
    coladas:S.coladas
  });
  $('#btnGenerar').disabled = true;
  try{
    if (!navigator.onLine) throw new Error('offline');
    const r = await call(payload);
    if (!r.ok) throw new Error(r.error || 'Error del servidor');
    showResult(r);
  }catch(e){
    if (offlineErr(e)){
      queue(payload);
      $('#queuedMsg').hidden = false;
      $('#queuedMsg').textContent = 'Guardado en cola: se enviará al recuperar señal.';
      msg.className = 'msg ok'; msg.textContent = 'Inspección en cola ✓';
    } else { msg.textContent = e.message; }
  }finally{ $('#btnGenerar').disabled = false; }
}
function showResult(r){
  const e = r.encabezado || {};
  $('#resSol').textContent   = e.solicitante || '—';
  $('#resCli').textContent   = e.cliente || '—';
  $('#resLugar').textContent = e.lugar || '—';
  $('#resCnt').textContent   = (e.nColadas != null ? e.nColadas + ' / ' + e.nMuestras : '—');
  $('#resTon').textContent   = e.totalTon || '—';
  const a = $('#resPdf');
  if (r.pdfUrl){ a.href = r.pdfUrl; a.hidden = false; } else a.hidden = true;
  const av = $('#resAvisos');
  if (av){
    if (r.avisos && r.avisos.length){ av.hidden = false; av.textContent = 'Avisos: ' + r.avisos.join(' · '); }
    else av.hidden = true;
  }
  show('viewResult');
}

// ==== cola offline ====
function queue(p){
  const q = JSON.parse(localStorage.getItem('terrapp.queue') || '[]');
  q.push({ p, ts:Date.now() }); localStorage.setItem('terrapp.queue', JSON.stringify(q));
}
async function flushQueue(){
  if (!navigator.onLine) return;
  let q = JSON.parse(localStorage.getItem('terrapp.queue') || '[]');
  if (!q.length) return;
  const rest = [];
  for (const item of q){
    try{ const r = await call(item.p); if (!r.ok) rest.push(item); }
    catch(_){ rest.push(item); }
  }
  localStorage.setItem('terrapp.queue', JSON.stringify(rest));
}

// ==== Clientes / OTE ====
function openClientes(){ show('viewClientes'); cargarClientes($('#cliQ').value); }

async function cargarClientes(q){
  const ul = $('#cliList'), msg = $('#cliMsg');
  msg.textContent = ''; ul.innerHTML = '<li class="hint">Cargando…</li>';
  try{
    const r = await call(withAuth({ accion:'ote_listar', q }));
    if (!r.ok) throw new Error(r.error || 'Error');
    const regs = r.registros || [];
    if (!regs.length){ ul.innerHTML = '<li class="hint">Sin resultados.</li>'; return; }
    ul.innerHTML = '';
    regs.forEach(g => {
      const li = document.createElement('li');
      li.innerHTML = `<div>
          <b>${esc(g.ote)}</b> · ${esc(g.cliente)}
          <div class="meta">${esc(g.sede || 'sin sede')} — ${esc(g.calle||'')} ${esc(g.comuna||'')}
            ${g.nombre ? ' · ' + esc(g.nombre) : ''}</div>
        </div>
        <div class="sbtns">
          <button class="secondary" data-edit>Editar</button>
          <button class="link" data-del>Borrar</button>
        </div>`;
      li.querySelector('[data-edit]').onclick = () => openOte(g);
      li.querySelector('[data-del]').onclick = () => borrarOte(g);
      ul.appendChild(li);
    });
  }catch(e){
    ul.innerHTML = '';
    msg.textContent = offlineErr(e) ? 'Sin conexión' : e.message;
  }
}
function openOte(g){
  const f = $('#formOte'); f.reset();
  S.cliEditId = g ? g.id : null;
  $('#dlgOteTitle').textContent = g ? 'Editar ubicación' : 'Nueva ubicación';
  if (g){ f.ote.value=g.ote; f.cliente.value=g.cliente; f.nombre.value=g.nombre||'';
    f.calle.value=g.calle||''; f.comuna.value=g.comuna||''; f.sede.value=g.sede||''; }
  $('#dlgOte').showModal();
}
async function onOteSubmit(ev){
  if (ev.submitter && ev.submitter.value === 'cancel') return;
  ev.preventDefault();
  const f = ev.target;
  const registro = {
    id: S.cliEditId,
    ote:f.ote.value.trim(), cliente:f.cliente.value.trim(), nombre:f.nombre.value.trim(),
    calle:f.calle.value.trim(), comuna:f.comuna.value.trim(), sede:f.sede.value.trim()
  };
  if (!registro.ote || !registro.cliente){ alert('OTE y Empresa son obligatorios'); return; }
  try{
    const r = await call(withAuth({ accion:'ote_guardar', registro }));
    if (!r.ok) throw new Error(r.error || 'Error');
    $('#dlgOte').close();
    cargarClientes($('#cliQ').value);
  }catch(e){ alert(offlineErr(e) ? 'Sin conexión: no se guardó' : e.message); }
}
async function borrarOte(g){
  if (!confirm(`¿Borrar la ubicación "${g.sede || g.comuna || g.ote}" del OTE ${g.ote}?`)) return;
  try{
    const r = await call(withAuth({ accion:'ote_eliminar', id:g.id }));
    if (!r.ok) throw new Error(r.error || 'Error');
    cargarClientes($('#cliQ').value);
  }catch(e){ alert(offlineErr(e) ? 'Sin conexión: no se borró' : e.message); }
}
