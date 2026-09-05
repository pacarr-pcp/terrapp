'use strict';
/* TerrApp B2 — PWA cliente.
   Habla con el Apps Script Web App por HTTPS. NO lleva credenciales:
   sólo la URL pública del backend. */

// ==== CONFIG ====
const BACKEND_URL = 'PEGAR_AQUI_LA_URL_/exec_DEL_APPS_SCRIPT';

const TIPOS = ['Perfil cuadrado','Perfil rectangular','Perfil canal','Plancha','Angulo plegado',
  'Angulo laminado','Viga UPN','Viga IPE','Viga IPN','Viga HEA','Viga HEB','Viga WF','Viga I',
  'Viga H','Cañería','Redondo','Costanera','Pletina','Bobina','Perfil Especial','Otro'];
const GRADOS = ['SAE1020','S275jr','A36','A572','A653','A992','A242','A588','A502','A709','A792',
  'A913','270ES','345ES','A53','A106','Q355','Q235','otro'];

// ==== estado ====
const S = {
  inspector:null, pin:null,
  header:{ ar:'', ote:'', ram:'', fecha:'', sedeId:'' },
  samples:[], editIndex:-1,
  cliEditId:null
};
const $ = s => document.querySelector(s);
const VIEWS = ['viewLogin','viewMenu','viewHeader','viewSamples','viewResult','viewClientes'];
function show(id){ VIEWS.forEach(v => $('#'+v).hidden = (v!==id)); window.scrollTo(0,0); }

// ==== arranque ====
document.addEventListener('DOMContentLoaded', () => {
  fill('#tipos', TIPOS); fill('#grados', GRADOS);
  $('#inFecha').value = todayISO();

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
  $('#btnAddSample').onclick  = () => openSample(-1);
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
function fill(sel, arr){ $(sel).innerHTML = arr.map(v => `<option value="${v}">`).join(''); }
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
  S.samples = [];
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
  if (!/^\d{3,5}$/.test(ar)) return (msg.textContent = 'AR: 3 a 5 dígitos');
  if (!ote)   return (msg.textContent = 'Falta el OTE');
  if (!fecha) return (msg.textContent = 'Falta la fecha');
  if (!S.header.sedeId) return (msg.textContent = 'Presiona "Buscar" y elige la ubicación del OTE');
  S.header.ar = ar; S.header.ote = ote; S.header.ram = ram; S.header.fecha = toCL(fecha);
  renderSamples(); show('viewSamples');
}

// ==== muestras ====
function renderSamples(){
  const ul = $('#sampleList'); ul.innerHTML = '';
  S.samples.forEach((m,i) => {
    const li = document.createElement('li');
    li.innerHTML = `<div>
        <b>${esc(m.muestra)}</b> — ${esc(m.tipo)}
        <div class="meta">${esc(m.dimension||'')} · ${esc(m.grado||'')} · Colada ${esc(m.colada||'—')}
          · ${num(m.peso)} kg · ${num(m.cantidad)} u · ${m.identificado ? 'Id.' : 'No Id.'}</div>
      </div>
      <div class="sbtns">
        <button class="secondary" data-e="${i}">Editar</button>
        <button class="link" data-d="${i}">Borrar</button>
      </div>`;
    ul.appendChild(li);
  });
  ul.querySelectorAll('[data-e]').forEach(b => b.onclick = () => openSample(+b.dataset.e));
  ul.querySelectorAll('[data-d]').forEach(b => b.onclick = () => { S.samples.splice(+b.dataset.d,1); renderSamples(); });
  $('#sampleCount').textContent = S.samples.length;
  $('#totKg').textContent = round(S.samples.reduce((a,m)=>a+num(m.peso),0));
  $('#totU').textContent  = S.samples.reduce((a,m)=>a+num(m.cantidad),0);
}
function openSample(i){
  S.editIndex = i;
  const f = $('#formSample'); f.reset();
  $('#dlgTitle').textContent = i<0 ? 'Nueva muestra' : 'Editar muestra';
  if (i>=0){ const m = S.samples[i];
    f.muestra.value=m.muestra; f.tipo.value=m.tipo; f.dimension.value=m.dimension||'';
    f.grado.value=m.grado||''; f.colada.value=m.colada||''; f.peso.value=m.peso||'';
    f.cantidad.value=m.cantidad||''; f.identificado.checked=!!m.identificado;
  }
  $('#dlgSample').showModal();
}
function onSampleSubmit(ev){
  if (ev.submitter && ev.submitter.value === 'cancel') return;
  const f = ev.target;
  const m = {
    muestra:f.muestra.value.trim(), tipo:f.tipo.value.trim(), dimension:f.dimension.value.trim(),
    grado:f.grado.value.trim(), colada:f.colada.value.trim(),
    peso:f.peso.value.trim(), cantidad:f.cantidad.value.trim(), identificado:f.identificado.checked
  };
  if (!m.muestra || !m.tipo){ ev.preventDefault(); alert('Muestra y Tipo son obligatorios'); return; }
  if (S.editIndex>=0) S.samples[S.editIndex] = m; else S.samples.push(m);
  renderSamples();
}

// ==== generar ====
async function generar(){
  const msg = $('#samplesMsg'); msg.textContent = ''; msg.className = 'msg';
  if (!S.samples.length) return (msg.textContent = 'Agregue al menos una muestra');
  const payload = withAuth({
    accion:'crear',
    ar:S.header.ar, ote:S.header.ote, ram:S.header.ram, fecha:S.header.fecha, sedeId:S.header.sedeId,
    muestras:S.samples
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
