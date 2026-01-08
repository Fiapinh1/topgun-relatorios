// =====================
// Utilitários
// =====================
const $ = (id) => document.getElementById(id);

function showStatus(msg, type = "info") {
  const el = $("status");
  el.className = `alert alert-${type} mt-3 mb-0`;
  el.textContent = msg;
  el.classList.remove("d-none");
}

function hideStatus() {
  $("status").classList.add("d-none");
}

function toNumberBR(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return isFinite(v) ? v : 0;
  let s = String(v).trim();
  if (!s) return 0;

  // remove unidades comuns
  s = s.replace(/(ha|l|lt|litros|min|mins|minutes|m)\b/gi, "").trim();

   // se vier como "11:10" (min:seg) ou "1:02:30" (h:m:s), converte para minutos decimais
   const timeParts = s.match(/^(\d+):(\d+)(?::(\d+))?$/);
   if (timeParts) {
     const h = timeParts[3] ? Number(timeParts[1]) : 0;
     const m = timeParts[3] ? Number(timeParts[2]) : Number(timeParts[1]);
     const sec = timeParts[3] ? Number(timeParts[3]) : Number(timeParts[2]);
     const totalMin = h * 60 + m + sec / 60;
     return isFinite(totalMin) ? totalMin : 0;
   }

  // se vier "1.234,56" -> "1234.56"
  // se vier "1,234.56" -> "1234.56"
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  if (hasComma && hasDot) {
    // assume dot como milhar e vírgula decimal (mais comum BR)
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (hasComma && !hasDot) {
    s = s.replace(",", ".");
  }
  const n = Number(s);
  return isFinite(n) ? n : 0;
}

function parseDateAny(v) {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;

  const s = String(v).trim();
  if (!s) return null;

  // se vier intervalo "2026-01-07 16:07:56-16:19:06", usa o trecho antes do hÇ?rario final
  const rangeSplit = s.split("-");
  const firstPart = rangeSplit.length > 1 ? rangeSplit[0].trim() : s;

  // tenta ISO
  const d1 = new Date(firstPart);
  if (!isNaN(d1.getTime())) return d1;

  // tenta dd/mm/yyyy
  const m = firstPart.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (m) {
    const dd = Number(m[1]), mm = Number(m[2]) - 1, yy = Number(m[3].length === 2 ? "20" + m[3] : m[3]);
    const hh = Number(m[4] || 0), mi = Number(m[5] || 0);
    const d2 = new Date(yy, mm, dd, hh, mi);
    return isNaN(d2.getTime()) ? null : d2;
  }

  return null;
}

function pickFirst(headers, candidates) {
  const low = headers.map(h => String(h).toLowerCase());
  for (const c of candidates) {
    const idx = low.findIndex(h => h.includes(c));
    if (idx >= 0) return headers[idx];
  }
  return "";
}

function csvDownload(filename, rows) {
  const escape = (v) => {
    const s = String(v ?? "");
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const csv = rows.map(r => r.map(escape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// =====================
// Estado
// =====================
let rawRows = [];        // linhas originais (objetos)
let headers = [];        // cabeçalho
let mapping = null;      // colunas escolhidas
let rankingRows = [];    // resultado agregado

// =====================
// Mapeamento (auto + manual)
// =====================
function buildMappingUI(headers, auto = true) {
  const selects = [
    ["colPilot", "Piloto"],
    ["colArea", "Área (ha)"],
    ["colVolume", "Volume (L)"],
    ["colTime", "Tempo (min)"],
    ["colDate", "Data"],
  ];

  for (const [id] of selects) {
    const sel = $(id);
    sel.innerHTML = "";
    const opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = "— selecione —";
    sel.appendChild(opt0);

    headers.forEach(h => {
      const opt = document.createElement("option");
      opt.value = h;
      opt.textContent = h;
      sel.appendChild(opt);
    });
  }

  if (auto) {
  $("colPilot").value = pickFirst(headers, ["pilot", "piloto", "pliot name", "pilot name", "operator", "operador", "user", "usuário", "usuario", "name", "nome"]);
  $("colArea").value  = pickFirst(headers, ["sprayed area", "area", "área", "task area", "spray area", "applied area", "hectare", "ha"]);
  $("colVolume").value= pickFirst(headers, ["total amount", "volume", "liquid", "spray", "tank", "consumed", "consumo", "used", "total liquid", "l"]);
  $("colTime").value  = pickFirst(headers, ["flight duration", "time", "duration", "tempo", "min"]);
  $("colDate").value  = pickFirst(headers, ["flight time", "date", "data", "start", "inicio", "início", "begin"]);
}

  $("mappingCard").classList.remove("d-none");
}

function getMappingFromUI() {
  return {
    pilot: $("colPilot").value,
    area: $("colArea").value,
    volume: $("colVolume").value,
    time: $("colTime").value,
    date: $("colDate").value
  };
}

// =====================
// Ranking / agregação
// =====================
function applyPeriodFilter(rows, days) {
  if (days === "all") return rows;
  const n = Number(days);
  const now = new Date();
  const cutoff = new Date(now.getTime() - n * 24 * 60 * 60 * 1000);
  return rows.filter(r => {
    const d = r.__date;
    return d && d >= cutoff;
  });
}

function normalizeRows(rows, map) {
  return rows.map(r => {
    const pilot = String(r[map.pilot] ?? "").trim() || "SEM PILOTO";
    const area = toNumberBR(r[map.area]);
    const volume = toNumberBR(r[map.volume]);
    const time = toNumberBR(r[map.time]);
    const d = map.date ? parseDateAny(r[map.date]) : null;

    return { pilot, area, volume, time, __date: d };
  });
}

function aggregateByPilot(normRows) {
  const acc = new Map();

  for (const r of normRows) {
    if (!acc.has(r.pilot)) {
      acc.set(r.pilot, { pilot: r.pilot, flights: 0, area: 0, volume: 0, time: 0 });
    }
    const a = acc.get(r.pilot);
    a.flights += 1;
    a.area += r.area;
    a.volume += r.volume;
    a.time += r.time;
  }

  const out = Array.from(acc.values()).map(x => {
    const lpha = x.area > 0 ? x.volume / x.area : 0;
    const haPerFlight = x.flights > 0 ? x.area / x.flights : 0;
    return { ...x, lpha, haPerFlight };
  });

  return out;
}

function sortRanking(rows, metric) {
  const key = metric;
  const dir = -1;
  return [...rows].sort((a, b) => (a[key] - b[key]) * dir);
}

function format(n, digits = 2) {
  return (Number(n) || 0).toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function renderTable(rows) {
  const tbody = $("rankingTable").querySelector("tbody");
  tbody.innerHTML = "";

  if (!rows.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="8" class="text-secondary">Nenhum resultado.</td>`;
    tbody.appendChild(tr);
    return;
  }

  rows.forEach((r, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="fw-semibold">${i + 1}</td>
      <td>${r.pilot}</td>
      <td class="text-end">${format(r.flights, 0)}</td>
      <td class="text-end">${format(r.area, 2)}</td>
      <td class="text-end">${format(r.volume, 1)}</td>
      <td class="text-end">${format(r.time, 0)}</td>
      <td class="text-end">${format(r.lpha, 2)}</td>
      <td class="text-end">${format(r.haPerFlight, 2)}</td>
    `;
    tbody.appendChild(tr);
  });
}

function refreshRankingUI() {
  if (!mapping) return;

  const period = $("periodSelect").value;
  const metric = $("metricSelect").value;
  const q = $("searchInput").value.trim().toLowerCase();

  const norm = normalizeRows(rawRows, mapping);
  const norm2 = applyPeriodFilter(norm, period);
  let agg = aggregateByPilot(norm2);

  if (q) agg = agg.filter(r => r.pilot.toLowerCase().includes(q));

  agg = sortRanking(agg, metric);

  rankingRows = agg;
  renderTable(agg);

  $("subtitle").textContent = `Pilotos: ${agg.length} • Registros: ${norm2.length}`;
  $("footnote").textContent = mapping.date
    ? "Filtro de período depende da coluna de data. Se estiver vazio, revise o mapeamento."
    : "Sem coluna de data mapeada: filtro de período não se aplica.";

  $("btnExportCsv").disabled = agg.length === 0;
}

// =====================
// Leitura: CSV / XLSX
// =====================
function setData(rows) {
  rawRows = rows;
  headers = rows.length ? Object.keys(rows[0]) : [];

  if (!headers.length) {
    showStatus("Não encontrei cabeçalhos/colunas. Verifique o arquivo.", "warning");
    return;
  }

  // tenta mapear automaticamente; se faltar algo, abre mapeamento
  buildMappingUI(headers, true);
  const autoMap = getMappingFromUI();

  const ok = autoMap.pilot && autoMap.area && autoMap.volume && autoMap.time;
  mapping = ok ? autoMap : null;

  if (mapping) {
    $("mappingCard").classList.add("d-none");
    enableRankingControls();
    refreshRankingUI();
    hideStatus();
  } else {
    showStatus("Não consegui identificar todas as colunas automaticamente. Selecione manualmente no painel de mapeamento.", "warning");
  }
}

function enableRankingControls() {
  $("searchInput").disabled = false;
  $("periodSelect").disabled = false;
}

function readCsvFile(file) {
  showStatus("Lendo CSV…", "info");
  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
    complete: (res) => {
      const rows = (res.data || []).filter(r => Object.values(r).some(v => String(v ?? "").trim() !== ""));
      showStatus(`CSV carregado: ${rows.length} linhas`, "success");
      setData(rows);
    },
    error: (err) => showStatus("Erro ao ler CSV: " + err.message, "danger"),
  });
}

function readXlsxFile(file) {
  showStatus("Lendo XLSX…", "info");
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = new Uint8Array(e.target.result);
      const wb = XLSX.read(data, { type: "array" });
      const wsName = wb.SheetNames[0];
      const ws = wb.Sheets[wsName];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
      showStatus(`XLSX carregado: ${rows.length} linhas`, "success");
      setData(rows);
    } catch (err) {
      showStatus("Erro ao ler XLSX: " + err.message, "danger");
    }
  };
  reader.readAsArrayBuffer(file);
}

// =====================
// Google Sheets (publicado como CSV)
// =====================
function buildGvizCsvUrl(sheetUrl) {
  // Aceita link normal do Sheets e transforma em gviz CSV
  // Exemplo final:
  // https://docs.google.com/spreadsheets/d/ID/gviz/tq?tqx=out:csv&sheet=ABA
  const m = sheetUrl.match(/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!m) return null;
  const id = m[1];

  // tenta extrair "gid" ou "sheet"
  const sheetNameMatch = sheetUrl.match(/sheet=([^&]+)/i);
  const sheetName = sheetNameMatch ? decodeURIComponent(sheetNameMatch[1]) : "Sheet1";

  return `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
}

async function loadFromGoogleSheets() {
  const urlIn = $("sheetUrl").value.trim();
  if (!urlIn) return showStatus("Cole um link de Google Sheets.", "warning");

  const csvUrl = buildGvizCsvUrl(urlIn) || urlIn;

  showStatus("Carregando do Google Sheets…", "info");
  try {
    const resp = await fetch(csvUrl);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const csvText = await resp.text();

    const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });
    const rows = (parsed.data || []).filter(r => Object.values(r).some(v => String(v ?? "").trim() !== ""));
    showStatus(`Sheets carregado: ${rows.length} linhas`, "success");
    setData(rows);
  } catch (err) {
    showStatus("Falha ao carregar do Sheets. Verifique se a planilha está publicada e acessível. Detalhe: " + err.message, "danger");
  }
}

// =====================
// Demo (só pra testar UI)
// =====================
function loadDemo() {
  const rows = [
    { "Piloto": "João", "Área (ha)": "45,2", "Volume (L)": "520", "Tempo (min)": "180", "Data": "05/01/2026" },
    { "Piloto": "Maria", "Área (ha)": "60,0", "Volume (L)": "690", "Tempo (min)": "210", "Data": "06/01/2026" },
    { "Piloto": "João", "Área (ha)": "30,1", "Volume (L)": "350", "Tempo (min)": "120", "Data": "06/01/2026" },
  ];
  setData(rows);
}

// =====================
// Eventos
// =====================
$("fileInput").addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  const name = file.name.toLowerCase();
  if (name.endsWith(".csv")) readCsvFile(file);
  else if (name.endsWith(".xlsx") || name.endsWith(".xls")) readXlsxFile(file);
  else showStatus("Formato não suportado. Use CSV ou XLSX.", "warning");
});

$("btnLoadSheet").addEventListener("click", loadFromGoogleSheets);
$("btnDemo").addEventListener("click", loadDemo);

$("btnHideMapping").addEventListener("click", () => $("mappingCard").classList.add("d-none"));

$("btnApplyMapping").addEventListener("click", () => {
  const m = getMappingFromUI();
  if (!m.pilot || !m.area || !m.volume || !m.time) {
    return showStatus("Mapeamento incompleto: piloto/área/volume/tempo são obrigatórios.", "warning");
  }
  mapping = m;
  $("mappingCard").classList.add("d-none");
  enableRankingControls();
  hideStatus();
  refreshRankingUI();
});

$("metricSelect").addEventListener("change", refreshRankingUI);
$("periodSelect").addEventListener("change", refreshRankingUI);
$("searchInput").addEventListener("input", refreshRankingUI);

$("btnExportCsv").addEventListener("click", () => {
  if (!rankingRows.length) return;

  const out = [
    ["posicao","piloto","voos","area_ha","volume_l","tempo_min","l_ha","ha_por_voo"],
    ...rankingRows.map((r, i) => [
      i + 1,
      r.pilot,
      r.flights,
      r.area.toFixed(2),
      r.volume.toFixed(1),
      Math.round(r.time),
      r.lpha.toFixed(2),
      r.haPerFlight.toFixed(2)
    ])
  ];
  csvDownload("ranking_pilotos.csv", out);
});
