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
  cliEditId:null, pesoTouched:false
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
  $('#selTipo').addEventListener('change', () => { toggleStd(); recalcPeso(); });
  $('#selGrado').addEventListener('change', applyGradoColor);
  $('#chkId').addEventListener('change', () => { toggleIdLabel(); updateMuestrasPrev(); });
  $('#btnStd').addEventListener('click', aplicarStd);
  $('#formSample').dimension.addEventListener('input', recalcPeso);
  $('#formSample').cantidad.addEventListener('input', recalcPeso);
  $('#formSample').peso.addEventListener('input', () => {
    S.pesoTouched = $('#formSample').peso.value.trim() !== '';
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
  toggleStd(); applyGradoColor();
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
function toggleStd(){
  const es = $('#selTipo').value === 'Plancha';
  const row = $('#stdRow'), btn = $('#btnStd');
  if (row) row.hidden = !es;
  if (btn) btn.classList.toggle('std-on', es);
}
function aplicarStd(){
  const f = $('#formSample');
  const esp = ($('#espStd').value.trim() || f.dimension.value.trim()).replace(/\s/g,'');
  if (!esp) { $('#espStd').focus(); return; }
  f.dimension.value = esp + 'x2440x12000';
  recalcPeso();
}

// Tablas de peso (Kg+ portado). Se cargan de data/pesos.json al inicio.
let PESOS = null;
const DENS = 7.85e-6;   // kg/mm³ (acero)

// tipo del <select> -> { t: tabla en pesos.lineales, k: constructor de clave, alt?: 2ª tabla }
const TABLA_TIPO = {
  'Perfil rectangular': { t:'rectangular', k:n=>`${n[0]}x${n[1]}e${n[2]}` },
  'Perfil cuadrado':    { t:'cuadrado',    k:n=>`${n[0]}x${n[1]}` },
  'Perfil canal':       { t:'canal',       k:n=>`${n[0]}x${n[1]}e${n[2]}` },
  'Costanera':          { t:'costanera',   k:n=>`${n[0]}x${n[1]}e${n[2]}` },
  'Angulo laminado':    { t:'angulo',      k:n=>`${n[0]}x${n[1]}` },
  'Viga UPN': { t:'viga_upn', k:n=>`${n[0]}` },
  'Viga IPE': { t:'viga_ipe', k:n=>`${n[0]}` },
  'Viga IPN': { t:'viga_ipn', k:n=>`${n[0]}` },
  'Viga HEA': { t:'viga_hea', k:n=>`${n[0]}` },
  'Viga HEB': { t:'viga_heb', k:n=>`${n[0]}` },
  'Viga I':   { t:'wf_i', k:n=>`${n[0]}x${n[1]}` },
  'viga H':   { t:'wf_h', k:n=>`${n[0]}x${n[1]}` },
  'Viga WF':  { t:'wf_i', k:n=>`${n[0]}x${n[1]}`, alt:'wf_h' },
  'Cañería':  { t:'caneria_a53', k:n=>`${n[0]}s${n[1]}`, alt:'caneria_a106' }
};

function dimsNum(dim){
  return String(dim||'').split(/[x×*\s]+/)
    .map(s => parseFloat(String(s).replace(',','.'))).filter(v => isFinite(v));
}

// -> { kg, via:'fórmula'|'tabla' } o null
function pesoColada(tipo, dim, cant){
  const n = dimsNum(dim), q = num(cant);
  if (!q || n.length < 2) return null;

  if (tipo === 'Plancha'){
    if (n.length < 3) return null;
    return { kg: n[0]*n[1]*n[2]*q*DENS, via:'fórmula' };
  }
  const map = TABLA_TIPO[tipo];
  if (!map || !PESOS) return null;
  const largoM = n[n.length-1] / 1000;                 // último número = largo en mm
  if (!largoM) return null;
  const clave = String(map.k(n)).toLowerCase();
  let kgm = (PESOS.lineales[map.t]||{})[clave];
  if (kgm == null && map.alt) kgm = (PESOS.lineales[map.alt]||{})[clave];
  if (kgm == null) return null;
  return { kg: kgm * largoM * q, via:'tabla' };
}

function recalcPeso(){
  const f = $('#formSample'), note = $('#pesoCalcNote');
  const setNote = t => { if (note) note.textContent = t; };
  if (S.pesoTouched){ setNote(''); return; }
  const r = pesoColada(f.tipo.value, f.dimension.value, f.cantidad.value);
  if (!r){ f.peso.value = ''; setNote(''); updateMuestrasPrev(); return; }
  f.peso.value = Math.round(r.kg);
  setNote('≈ ' + r.via + ' (editable)');
  updateMuestrasPrev();
}
function toggleIdLabel(){ const l = $('#idLabel'); if (l) l.classList.toggle('on', $('#chkId').checked); }
function pad2(x){ const v = String(x||'').replace(/\D/g,''); return v ? v.padStart(2,'0').slice(-2) : ''; }
function updateMuestrasPrev(){
  const f = $('#formSample'), p = $('#muestrasPrev');
  if (!p) return;
  const kg = num(f.peso.value);
  if (!kg){ p.textContent = ''; return; }
  const n = nMuestras(kg, f.identificado.checked);
  const ar = S.header.ar || '####', pp = pad2(f.pos.value) || 'PP';
  const ej = [];
  for (let k=1;k<=n;k++) ej.push(`${ar}-${pp}-${pad2(k)}${pad2(n)}`);
  p.innerHTML = `→ <b>${n}</b> muestra${n>1?'s':''}: ${ej.join(', ')}`;
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

async function buscarOte(){
  const ote = $('#inOte').value.trim();
  const box = $('#sedeBox'); box.innerHTML = ''; S.header.sedeId = '';
  if (!ote) return;
  box.textContent = 'Buscando…';
  try{
    const r = await call(withAuth({ accion:'sedes', ote }));
    if (!r.ok) throw new Error(r.error || 'Error');
    const sedes = r.sedes || [];
    if (!sedes.length){
      box.innerHTML = `<p class="hint">OTE sin ubicaciones. Agrégala en <b>Clientes</b>.</p>`;
      return;
    }
    if (sedes.length === 1){
      S.header.sedeId = sedes[0].id;
      box.innerHTML = `<p class="hint">Cliente: <b>${esc(sedes[0].cliente)}</b>` +
        `${sedes[0].sede ? ' · ' + esc(sedes[0].sede) : ''}` +
        `${sedes[0].comuna ? ' · ' + esc(sedes[0].comuna) : ''}</p>`;
      return;
    }
    const opts = sedes.map(s =>
      `<option value="${esc(s.id)}">${esc(s.cliente)} — ${esc(s.sede || s.comuna || 'sin etiqueta')}</option>`
    ).join('');
    box.innerHTML = `<label>Ubicación / nombre a usar
      <select id="selSede">${opts}</select></label>`;
    S.header.sedeId = sedes[0].id;
    $('#selSede').addEventListener('change', e => { S.header.sedeId = e.target.value; });
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
  if (!S.header.sedeId) return (msg.textContent = 'Presiona "Buscar" y elige la ubicación del OTE');
  S.header.ar = ar; S.header.ote = ote; S.header.ram = ram; S.header.fecha = toCL(fecha);
  renderColadas(); show('viewSamples');
}

// ==== coladas ====
function renderColadas(){
  const ul = $('#sampleList'); ul.innerHTML = '';
  let totM = 0, totKg = 0, totU = 0;
  S.coladas.forEach((c,i) => {
    const n = nMuestras(c.peso, c.identificada);
    totM += n; totKg += num(c.peso); totU += num(c.cantidad);
    const li = document.createElement('li');
    li.innerHTML = `<div>
        <b>Col. ${esc(c.pos)}</b> · ${esc(c.tipo)}
        <span style="color:${gradoColor(c.grado)};font-weight:700"> ${esc(c.grado||'')}</span>
        <span class="pill">${n} m</span>
        <div class="meta">${esc(c.dimension||'')} · Colada ${esc(c.colada||'—')}
          · ${num(c.cantidad)} u · ${num(c.peso)} kg · ${c.identificada ? '✔ Identificada' : 'No Id.'}</div>
        <div class="meta">${S.header.ar}-${esc(c.pos)}-${pad2(1)}${pad2(n)}${n>1?` … ${S.header.ar}-${esc(c.pos)}-${pad2(n)}${pad2(n)}`:''}</div>
      </div>
      <div class="sbtns">
        <button class="secondary" data-e="${i}">Editar</button>
        <button class="link" data-d="${i}">Borrar</button>
      </div>`;
    ul.appendChild(li);
  });
  ul.querySelectorAll('[data-e]').forEach(b => b.onclick = () => openColada(+b.dataset.e));
  ul.querySelectorAll('[data-d]').forEach(b => b.onclick = () => { S.coladas.splice(+b.dataset.d,1); renderColadas(); });
  $('#sampleCount').textContent = S.coladas.length;
  $('#totMuestras').textContent = totM;
  $('#totKg').textContent = round(totKg);
  $('#totU').textContent  = totU;
}
function openColada(i){
  S.editIndex = i;
  const f = $('#formSample'); f.reset();
  $('#dlgTitle').textContent = i<0 ? 'Nueva colada' : 'Editar colada';
  const c = i>=0 ? S.coladas[i] : {};
  f.pos.value       = c.pos || pad2(S.coladas.length + 1);
  f.tipo.value      = c.tipo || 'Plancha';
  f.dimension.value = c.dimension || '';
  f.grado.value     = c.grado || 'A36';
  f.colada.value    = c.colada || '';
  f.cantidad.value  = c.cantidad || '';
  f.peso.value      = c.peso || '';
  f.identificado.checked = !!c.identificada;
  $('#espStd').value = '';
  S.pesoTouched = (i >= 0 && !!c.peso);   // en edición se respeta el peso guardado
  toggleStd(); applyGradoColor(); toggleIdLabel();
  if (!S.pesoTouched) recalcPeso();
  updateMuestrasPrev();
  $('#dlgSample').showModal();
}
function onSampleSubmit(ev){
  if (ev.submitter && ev.submitter.value === 'cancel') return;
  const f = ev.target;
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
