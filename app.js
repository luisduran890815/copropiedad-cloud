const cfg = window.APP_CONFIG;
const sb = supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

let session = null;
let profile = null;
let rows = [];
let pdfSolicitudId = null;

const $ = (id) => document.getElementById(id);
const cop = (value) => new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0
}).format(value || 0);
const esc = (value) => String(value || '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[char]));

const canEdit = () => ['admin', 'operador'].includes(profile?.role);
const isAdmin = () => profile?.role === 'admin';

async function init() {
  const { data } = await sb.auth.getSession();
  if (data.session) await enter(data.session);
}

$('loginForm').onsubmit = async (event) => {
  event.preventDefault();
  $('loginMsg').textContent = 'Ingresando...';

  const { data, error } = await sb.auth.signInWithPassword({
    email: $('email').value,
    password: $('password').value
  });

  if (error) {
    $('loginMsg').textContent = error.message;
    return;
  }

  await enter(data.session);
};

async function enter(currentSession) {
  session = currentSession;

  const { data, error } = await sb
    .from('profiles')
    .select('*')
    .eq('id', currentSession.user.id)
    .single();

  if (error) {
    alert('No fue posible cargar el perfil. Ejecuta setup.sql y crea el perfil.');
    return;
  }

  profile = data;
  $('login').classList.add('hidden');
  $('app').classList.remove('hidden');
  $('usuario').textContent = `${currentSession.user.email} · ${profile.role}`;
  await load();
}

$('salir').onclick = async () => {
  await sb.auth.signOut();
  location.reload();
};

async function upload(files, requestId, tipo) {
  const paths = [];

  for (const file of files) {
    if (file.size > 4000000) throw new Error(`${file.name} supera 4 MB`);

    const clean = file.name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9._-]/g, '_');

    const path = `${requestId}/${tipo}/${crypto.randomUUID()}-${clean}`;
    const { error } = await sb.storage
      .from('mantenimiento')
      .upload(path, file, { contentType: file.type });

    if (error) throw error;
    paths.push({ path, tipo, nombre: file.name });
  }

  return paths;
}

$('solForm').onsubmit = async (event) => {
  event.preventDefault();

  try {
    $('formMsg').textContent = 'Guardando...';
    const id = crypto.randomUUID();
    const antes = await upload([...$('fotosAntes').files], id, 'antes');
    const despues = await upload([...$('fotosDespues').files], id, 'despues');

    const payload = {
      id,
      solicitante: $('solicitante').value,
      ubicacion: $('ubicacion').value,
      descripcion: $('descripcion').value,
      prioridad: $('prioridad').value,
      estado: $('estado').value,
      fecha_ejecucion: $('fechaEjecucion').value || null,
      contratista: $('contratista').value,
      costo: Number($('costo').value || 0),
      observaciones: $('observaciones').value,
      created_by: session.user.id
    };

    const { error } = await sb.from('solicitudes').insert(payload);
    if (error) throw error;

    const evidencias = [...antes, ...despues];
    if (evidencias.length) {
      const { error: evidenceError } = await sb.from('evidencias').insert(
        evidencias.map((item) => ({
          solicitud_id: id,
          ...item,
          created_by: session.user.id
        }))
      );
      if (evidenceError) throw evidenceError;
    }

    event.target.reset();
    $('formMsg').textContent = 'Solicitud guardada correctamente.';
    await load();
  } catch (error) {
    $('formMsg').textContent = `Error: ${error.message}`;
  }
};

async function load() {
  const { data, error } = await sb
    .from('solicitudes')
    .select('*,evidencias(*)')
    .order('created_at', { ascending: false });

  if (error) {
    alert(error.message);
    return;
  }

  rows = data || [];
  render();
}

function render() {
  const query = $('buscar').value.toLowerCase();
  const filter = $('filtro').value;
  const visible = rows.filter((item) =>
    (!filter || item.estado === filter) &&
    JSON.stringify(item).toLowerCase().includes(query)
  );

  $('stTotal').textContent = rows.length;
  $('stPend').textContent = rows.filter((item) => item.estado === 'Pendiente').length;
  $('stEjec').textContent = rows.filter((item) => item.estado === 'Ejecutada').length;
  $('stCosto').textContent = cop(rows.reduce((sum, item) => sum + Number(item.costo), 0));

  $('lista').innerHTML = visible.map((item) => `
    <div class="row">
      <div>
        <h3>${esc(item.codigo)} · ${esc(item.descripcion)}</h3>
        <span class="tag">${esc(item.estado)}</span>
        <span class="tag">${esc(item.prioridad)}</span>
        <p>${esc(item.ubicacion)} · ${new Date(item.created_at).toLocaleDateString('es-CO')}</p>
      </div>
      <b>${cop(item.costo)}</b>
      <span>${item.fecha_ejecucion || 'Sin ejecutar'}</span>
      <div class="smallActions">
        <button onclick="detail('${item.id}')">Ver / reporte</button>
        ${canEdit() ? `<button class="ok" onclick="editRequest('${item.id}')">Editar</button>` : ''}
      </div>
    </div>
  `).join('');
}

$('buscar').oninput = render;
$('filtro').onchange = render;

async function signed(path) {
  const { data, error } = await sb.storage
    .from('mantenimiento')
    .createSignedUrl(path, 3600);

  if (error) throw error;
  return data.signedUrl;
}

async function detail(id) {
  const item = rows.find((row) => row.id === id);
  if (!item) return alert('Solicitud no encontrada.');

  const evidencias = await Promise.all(
    (item.evidencias || []).map(async (evidence) => ({
      ...evidence,
      url: await signed(evidence.path)
    }))
  );

  window.current = { ...item, evidencias };
  pdfSolicitudId = null;

  const reportEnabled = item.estado === 'Ejecutada' || item.estado === 'Archivada';

  $('detalle').innerHTML = `
    <h2>${esc(item.codigo)}</h2>
    <p><b>${esc(item.descripcion)}</b></p>
    <p>
      Ubicación: ${esc(item.ubicacion)}<br>
      Estado: ${esc(item.estado)}<br>
      Fecha ejecución: ${item.fecha_ejecucion || 'No registrada'}<br>
      Contratista: ${esc(item.contratista)}<br>
      Coste: ${cop(item.costo)}
    </p>
    <p>${esc(item.observaciones)}</p>

    ${canEdit() ? `
      <div class="reportActions">
        <button class="ok" onclick="editRequest('${item.id}')">Editar solicitud</button>
        <button onclick="changeStatus('${item.id}')">Cambiar estado</button>
      </div>
    ` : ''}

    <h3>Fotos antes</h3>
    <div class="gallery">
      ${evidencias.filter((e) => e.tipo === 'antes').map((e) => `<img src="${e.url}" alt="Foto antes">`).join('') || 'Sin fotos'}
    </div>

    <h3>Fotos después</h3>
    <div class="gallery">
      ${evidencias.filter((e) => e.tipo === 'despues').map((e) => `<img src="${e.url}" alt="Foto después">`).join('') || 'Sin fotos'}
    </div>

    ${reportEnabled ? `
      <div class="reportActions">
        <button onclick="downloadPDF()">Descargar PDF</button>
        <button class="ok" onclick="emailPDF()">Enviar PDF por correo</button>
        ${isAdmin() ? `<button class="danger" onclick="removeRequest('${item.id}')">Eliminar definitivamente</button>` : ''}
      </div>
      ${isAdmin() ? '<p class="notice">Para eliminar, primero debe descargar o enviar el PDF de esta solicitud.</p>' : ''}
    ` : `
      <p class="notice">El informe se habilita cuando el estado sea Ejecutada o Archivada.</p>
    `}
  `;

  $('modal').classList.remove('hidden');
}

$('cerrarModal').onclick = () => $('modal').classList.add('hidden');

async function editRequest(id) {
  if (!canEdit()) return alert('Acceso denegado.');

  const item = rows.find((row) => row.id === id);
  if (!item) return alert('Solicitud no encontrada.');

  const solicitante = prompt('Solicitante:', item.solicitante || '');
  if (solicitante === null) return;
  const ubicacion = prompt('Ubicación / zona:', item.ubicacion || '');
  if (ubicacion === null || !ubicacion.trim()) return alert('La ubicación es obligatoria.');
  const descripcion = prompt('Descripción:', item.descripcion || '');
  if (descripcion === null || !descripcion.trim()) return alert('La descripción es obligatoria.');
  const prioridad = prompt('Prioridad: Baja, Media, Alta o Urgente', item.prioridad || 'Media');
  if (prioridad === null) return;

  const prioridades = ['Baja', 'Media', 'Alta', 'Urgente'];
  if (!prioridades.includes(prioridad)) return alert('Prioridad no válida.');

  const fechaEjecucion = prompt('Fecha de ejecución (AAAA-MM-DD) o vacío:', item.fecha_ejecucion || '');
  if (fechaEjecucion === null) return;
  const contratista = prompt('Contratista:', item.contratista || '');
  if (contratista === null) return;
  const costoTexto = prompt('Coste final COP:', String(item.costo || 0));
  if (costoTexto === null) return;
  const costo = Number(costoTexto);
  if (!Number.isFinite(costo) || costo < 0) return alert('Coste no válido.');
  const observaciones = prompt('Observaciones:', item.observaciones || '');
  if (observaciones === null) return;

  const { error } = await sb
    .from('solicitudes')
    .update({
      solicitante,
      ubicacion: ubicacion.trim(),
      descripcion: descripcion.trim(),
      prioridad,
      fecha_ejecucion: fechaEjecucion.trim() || null,
      contratista,
      costo,
      observaciones
    })
    .eq('id', id);

  if (error) return alert(error.message);

  pdfSolicitudId = null;
  await load();
  $('modal').classList.add('hidden');
  alert('Solicitud actualizada correctamente.');
}

async function changeStatus(id) {
  if (!canEdit()) return alert('Acceso denegado.');

  const item = rows.find((row) => row.id === id);
  if (!item) return alert('Solicitud no encontrada.');

  const estado = prompt(
    'Nuevo estado:\nPendiente\nProgramada\nEn ejecución\nEjecutada\nArchivada',
    item.estado
  );

  if (estado === null) return;

  const estadosValidos = ['Pendiente', 'Programada', 'En ejecución', 'Ejecutada', 'Archivada'];
  if (!estadosValidos.includes(estado)) return alert('Estado no válido. Escríbalo exactamente como aparece en la lista.');

  const changes = { estado };
  if (estado === 'Ejecutada' && !item.fecha_ejecucion) {
    changes.fecha_ejecucion = new Date().toISOString().slice(0, 10);
  }

  const { error } = await sb
    .from('solicitudes')
    .update(changes)
    .eq('id', id);

  if (error) return alert(error.message);

  pdfSolicitudId = null;
  await load();
  await detail(id);
  alert('Estado actualizado correctamente.');
}

async function imageToDataUrl(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('No se pudo cargar una imagen.');
  const blob = await response.blob();

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function makePDF() {
  const item = window.current;
  if (!item) throw new Error('No hay una solicitud abierta.');

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setFontSize(18);
  doc.text('Informe de cierre de mantenimiento', 15, 18);
  doc.setFontSize(10);

  let y = 30;
  const lines = [
    `Código: ${item.codigo}`,
    `Ubicación: ${item.ubicacion}`,
    `Descripción: ${item.descripcion}`,
    `Estado: ${item.estado}`,
    `Fecha de ejecución: ${item.fecha_ejecucion || ''}`,
    `Contratista: ${item.contratista || ''}`,
    `Coste: ${cop(item.costo)}`,
    `Observaciones: ${item.observaciones || ''}`
  ];

  for (const line of lines) {
    const parts = doc.splitTextToSize(line, 180);
    doc.text(parts, 15, y);
    y += parts.length * 6;
  }

  for (const tipo of ['antes', 'despues']) {
    doc.addPage();
    doc.setFontSize(15);
    doc.text(`Fotografías ${tipo}`, 15, 18);

    let imageY = 28;
    const images = item.evidencias.filter((evidence) => evidence.tipo === tipo);

    if (!images.length) {
      doc.setFontSize(10);
      doc.text('Sin fotografías', 15, imageY);
      continue;
    }

    for (const evidence of images) {
      try {
        const dataUrl = await imageToDataUrl(evidence.url);
        const format = dataUrl.startsWith('data:image/png') ? 'PNG' : 'JPEG';

        if (imageY > 220) {
          doc.addPage();
          imageY = 20;
        }

        doc.addImage(dataUrl, format, 15, imageY, 80, 60);
        imageY += 68;
      } catch (error) {
        doc.setFontSize(9);
        doc.text(`No fue posible incluir: ${evidence.nombre || 'imagen'}`, 15, imageY);
        imageY += 8;
      }
    }
  }

  return doc;
}

async function downloadPDF() {
  try {
    const doc = await makePDF();
    doc.save(`informe-${window.current.codigo}.pdf`);
    pdfSolicitudId = window.current.id;
    alert('PDF descargado. Ya puede eliminar esta solicitud si lo necesita.');
  } catch (error) {
    alert(`No se pudo generar el PDF: ${error.message}`);
  }
}

async function emailPDF() {
  const to = prompt('Correo destinatario:');
  if (!to) return;

  try {
    const doc = await makePDF();
    const pdfBase64 = doc.output('datauristring').split(',')[1];

    const response = await fetch('/.netlify/functions/send-report', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`
      },
      body: JSON.stringify({
        to,
        codigo: window.current.codigo,
        pdfBase64
      })
    });

    const output = await response.json();

    if (!response.ok) {
      alert(`Error: ${output.error || 'No se pudo enviar.'}`);
      return;
    }

    pdfSolicitudId = window.current.id;
    alert('Informe enviado correctamente. Ya puede eliminar esta solicitud si lo necesita.');
  } catch (error) {
    alert(`No se pudo enviar el informe: ${error.message}`);
  }
}

async function removeRequest(id) {
  if (!isAdmin()) return alert('Acceso denegado.');

  if (pdfSolicitudId !== id) {
    return alert('Antes de eliminar debe descargar o enviar el PDF de esta misma solicitud.');
  }

  const item = rows.find((row) => row.id === id);
  if (!item) return alert('Solicitud no encontrada.');

  if (prompt('Escribe ELIMINAR para borrar definitivamente la solicitud y sus fotos:') !== 'ELIMINAR') {
    return;
  }

  const paths = (item.evidencias || []).map((evidence) => evidence.path);

  if (paths.length) {
    const { error: storageError } = await sb.storage
      .from('mantenimiento')
      .remove(paths);

    if (storageError) return alert(storageError.message);
  }

  const { error } = await sb
    .from('solicitudes')
    .delete()
    .eq('id', id);

  if (error) return alert(error.message);

  pdfSolicitudId = null;
  $('modal').classList.add('hidden');
  await load();
  alert('Solicitud, evidencias y fotografías eliminadas correctamente.');
}

$('excel').onclick = () => {
  const data = rows.map(({ evidencias, ...item }) => ({
    ...item,
    fotos: evidencias?.length || 0
  }));

  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Solicitudes');
  XLSX.writeFile(workbook, 'solicitudes-mantenimiento.xlsx');
};

window.detail = detail;
window.editRequest = editRequest;
window.changeStatus = changeStatus;
window.removeRequest = removeRequest;
window.downloadPDF = downloadPDF;
window.emailPDF = emailPDF;

init();
