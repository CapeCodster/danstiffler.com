import { unzipSync } from "fflate";
import { RequestError } from "./http.js";

const decoder = new TextDecoder();
const MAX_UNCOMPRESSED_BYTES = 15 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 200;

function validateZipEnvelope(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let index = Math.max(0, bytes.byteLength - 65557); index <= bytes.byteLength - 22; index += 1) {
    if (view.getUint32(index, true) === 0x06054b50) end = index;
  }
  if (end < 0) throw new RequestError(400, "The selected file is not a readable .xlsx workbook");
  const entries = view.getUint16(end + 10, true);
  const centralSize = view.getUint32(end + 12, true);
  const centralOffset = view.getUint32(end + 16, true);
  if (entries < 1 || entries > MAX_ZIP_ENTRIES || centralOffset + centralSize > bytes.byteLength) throw new RequestError(400, "The workbook ZIP structure is invalid or too large");
  let offset = centralOffset;
  let total = 0;
  for (let index = 0; index < entries; index += 1) {
    if (offset + 46 > bytes.byteLength || view.getUint32(offset, true) !== 0x02014b50) throw new RequestError(400, "The workbook ZIP directory is invalid");
    const compressed = view.getUint32(offset + 20, true);
    const uncompressed = view.getUint32(offset + 24, true);
    if (compressed === 0xffffffff || uncompressed === 0xffffffff) throw new RequestError(400, "ZIP64 workbooks are not supported");
    total += uncompressed;
    if (total > MAX_UNCOMPRESSED_BYTES || (compressed > 0 && uncompressed / compressed > 250)) throw new RequestError(413, "The workbook expands beyond the safe XLSX limit");
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    offset += 46 + nameLength + extraLength + commentLength;
  }
}

function xmlText(bytes) {
  if (!bytes) throw new RequestError(400, "The workbook is missing required XLSX parts");
  return decoder.decode(bytes).replace(/^\uFEFF/, "");
}

function decodeXml(value) {
  return String(value || "")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function attributes(fragment) {
  const output = {};
  for (const match of fragment.matchAll(/([A-Za-z_:][\w:.-]*)="([^"]*)"/g)) output[match[1]] = decodeXml(match[2]);
  return output;
}

function sharedStrings(files) {
  const source = files["xl/sharedStrings.xml"];
  if (!source) return [];
  return [...xmlText(source).matchAll(/<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/g)].map((match) =>
    [...match[1].matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g)]
      .map((textMatch) => decodeXml(textMatch[1]))
      .join(""));
}

function columnIndex(reference) {
  const letters = String(reference || "").match(/^[A-Z]+/i)?.[0]?.toUpperCase() || "";
  let index = 0;
  for (const character of letters) index = (index * 26) + character.charCodeAt(0) - 64;
  return Math.max(0, index - 1);
}

function cellValue(fragment, type, strings) {
  if (type === "inlineStr") {
    return [...fragment.matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g)]
      .map((match) => decodeXml(match[1]))
      .join("");
  }
  const value = fragment.match(/<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/)?.[1] ?? "";
  if (type === "s") return strings[Number(value)] ?? "";
  if (type === "b") return value === "1" ? "TRUE" : "FALSE";
  return decodeXml(value);
}

function worksheetRows(bytes, strings) {
  const source = xmlText(bytes);
  const rows = [];
  for (const rowMatch of source.matchAll(/<(?:\w+:)?row\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?row>/g)) {
    const rowNumber = Number(attributes(rowMatch[1]).r || rows.length + 1);
    const cells = [];
    for (const cellMatch of rowMatch[2].matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
      const cellAttributes = attributes(cellMatch[1]);
      cells[columnIndex(cellAttributes.r)] = cellValue(cellMatch[2] || "", cellAttributes.t || "", strings);
    }
    rows.push({ rowNumber, cells });
  }
  return rows;
}

function workbookSheets(files) {
  const workbook = xmlText(files["xl/workbook.xml"]);
  const relationships = xmlText(files["xl/_rels/workbook.xml.rels"]);
  const targets = new Map();
  for (const match of relationships.matchAll(/<(?:\w+:)?Relationship\b([^>]*?)(?:\/>|>)/g)) {
    const item = attributes(match[1]);
    if (item.Id && item.Target) targets.set(item.Id, item.Target.replace(/^\//, ""));
  }
  return [...workbook.matchAll(/<(?:\w+:)?sheet\b([^>]*?)(?:\/>|>)/g)].map((match) => {
    const item = attributes(match[1]);
    const relationshipId = item["r:id"];
    return { name: item.name, path: targets.get(relationshipId) };
  }).filter((sheet) => sheet.name && sheet.path);
}

function normalizeHeader(value) {
  return String(value || "").trim().toLowerCase().replaceAll(/\s+/g, "_");
}

function excelDate(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value || "").trim().slice(0, 10);
  const utc = Date.UTC(1899, 11, 30) + (Math.floor(numeric) * 86400000);
  return new Date(utc).toISOString().slice(0, 10);
}

function excelTime(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value || "").trim().slice(0, 5);
  const minutes = Math.round((numeric - Math.floor(numeric)) * 1440) % 1440;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

const DATE_FIELDS = new Set([
  "start_date", "end_date", "day_date", "reserved_from", "reserved_to", "expected_arrival_date",
  "expected_departure_date", "departure_date", "arrival_date",
]);
const TIME_FIELDS = new Set([
  "start_time", "end_time", "check_in_time", "check_out_time", "expected_arrival_time",
  "expected_departure_time", "departure_time", "arrival_time",
]);

function normalizedCell(header, value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (DATE_FIELDS.has(header)) return excelDate(text);
  if (TIME_FIELDS.has(header)) return excelTime(text);
  return text;
}

function recordsForSheet(rows) {
  const headerIndex = rows.findIndex((row) => row.cells.some((cell) => normalizeHeader(cell) === "schema_version"));
  if (headerIndex < 0) return { headers: [], rows: [] };
  const headerRow = rows[headerIndex];
  const headers = headerRow.cells.map(normalizeHeader);
  const records = [];
  for (const row of rows.slice(headerIndex + 1)) {
    const values = {};
    headers.forEach((header, index) => {
      if (header) values[header] = normalizedCell(header, row.cells[index]);
    });
    if (!Object.entries(values).some(([header, value]) => header !== "schema_version" && String(value || "").trim())) continue;
    records.push({ rowNumber: row.rowNumber, values });
  }
  return { headerRow: headerRow.rowNumber, headers: headers.filter(Boolean), rows: records };
}

export function parseTripWorkbook(input) {
  let files;
  validateZipEnvelope(input);
  try { files = unzipSync(new Uint8Array(input)); }
  catch { throw new RequestError(400, "The selected file is not a readable .xlsx workbook"); }
  const strings = sharedStrings(files);
  const output = {};
  for (const sheet of workbookSheets(files)) {
    output[sheet.name] = recordsForSheet(worksheetRows(files[sheet.path], strings));
  }
  return output;
}
