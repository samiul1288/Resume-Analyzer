'use strict';

/**
 * Dependency-free DOCX text extraction.
 *
 * A .docx is a ZIP archive; the visible text lives in `word/document.xml`.
 * We read the ZIP central directory ourselves and inflate the entry with the
 * built-in zlib, so DOCX support works even with zero npm packages installed.
 */

const zlib = require('zlib');

const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;
const LFH_SIG = 0x04034b50;

/** Locate the End Of Central Directory record (scanning backwards, zip64-safe). */
function findEocd(buf) {
  const min = Math.max(0, buf.length - 66000);
  for (let i = buf.length - 22; i >= min; i -= 1) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}

/** List ZIP entries: { name, method, compressedSize, size, offset }. */
function readZipEntries(buf) {
  const eocd = findEocd(buf);
  if (eocd < 0) throw new Error('Not a valid ZIP/DOCX file (no central directory found).');
  const count = buf.readUInt16LE(eocd + 10);
  let ptr = buf.readUInt32LE(eocd + 16);
  const entries = [];

  for (let i = 0; i < count; i += 1) {
    if (ptr + 46 > buf.length || buf.readUInt32LE(ptr) !== CD_SIG) break;
    const method = buf.readUInt16LE(ptr + 10);
    const compressedSize = buf.readUInt32LE(ptr + 20);
    const size = buf.readUInt32LE(ptr + 24);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const offset = buf.readUInt32LE(ptr + 42);
    const name = buf.toString('utf8', ptr + 46, ptr + 46 + nameLen);
    entries.push({ name, method, compressedSize, size, offset });
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Inflate one entry (handles stored + deflate, sizes read from the local header). */
function readEntry(buf, entry) {
  const offset = entry.offset;
  if (buf.readUInt32LE(offset) !== LFH_SIG) throw new Error(`Corrupt ZIP entry: ${entry.name}`);
  const nameLen = buf.readUInt16LE(offset + 26);
  const extraLen = buf.readUInt16LE(offset + 28);
  const dataStart = offset + 30 + nameLen + extraLen;
  const data = buf.subarray(dataStart);

  if (entry.method === 0) return Buffer.from(data.subarray(0, entry.compressedSize));
  if (entry.method === 8) {
    try {
      return zlib.inflateRawSync(data.subarray(0, entry.compressedSize));
    } catch (error) {
      return zlib.inflateRawSync(data); // tolerate a wrong compressed-size field
    }
  }
  throw new Error(`Unsupported ZIP compression method ${entry.method} for ${entry.name}.`);
}

const XML_ENTITIES = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' '
};

function decodeXml(text) {
  return text
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g, (m) => XML_ENTITIES[m] || m)
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

/** Convert word/document.xml (or any WordprocessingML part) into plain text. */
function documentXmlToText(xml) {
  return decodeXml(
    xml
      .replace(/<w:tab\b[^>]*\/>/g, '\t')
      .replace(/<w:br\b[^>]*\/>/g, '\n')
      .replace(/<\/w:p>/g, '\n')
      .replace(/<\/w:tr>/g, '\n')
      .replace(/<\/w:tc>/g, ' | ')
      .replace(/<[^>]+>/g, '')
  );
}

/** Extract plain text from a DOCX buffer. */
function extractDocxText(buffer) {
  const entries = readZipEntries(buffer);
  const main = entries.find((e) => e.name === 'word/document.xml')
    || entries.find((e) => /^word\/document\d*\.xml$/.test(e.name));
  if (!main) {
    if (entries.some((e) => /^word\//.test(e.name))) {
      throw new Error('This DOCX has no readable document body (it may be saved in an unsupported format).');
    }
    throw new Error('This file is not a Word .docx document. If it is an old .doc file, save it as .docx or .pdf first.');
  }

  let text = documentXmlToText(readEntry(buffer, main).toString('utf8'));

  // Headers/footers often hold contact details - append what is not already present.
  for (const entry of entries) {
    if (/^word\/(header|footer)\d*\.xml$/.test(entry.name)) {
      const extra = documentXmlToText(readEntry(buffer, entry).toString('utf8')).trim();
      if (extra && !text.includes(extra)) text += `\n${extra}`;
    }
  }

  const links = entries.filter((e) => e.name === 'word/_rels/document.xml.rels');
  if (links.length) {
    const rels = readEntry(buffer, links[0]).toString('utf8');
    const urls = [...rels.matchAll(/Target="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
    const unique = [...new Set(urls)].filter((u) => !text.includes(u));
    if (unique.length) text += `\n${unique.join('\n')}`;
  }

  return text
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

module.exports = { extractDocxText, readZipEntries, readEntry, documentXmlToText };
