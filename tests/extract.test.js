'use strict';

/**
 * Extraction tests: the dependency-free DOCX (ZIP) reader, the built-in PDF
 * text parser and the file-type dispatcher.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');

const { extractDocxText } = require('../src/docx');
const { extractPdfText } = require('../src/pdf');
const { detectKind, stripRtf } = require('../src/extract');

/** Minimal ZIP writer (stored entries) so we can build a DOCX in memory. */
function makeZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const data = Buffer.from(entry.data, 'utf8');

    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0, 8); // stored
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(nameBuf.length, 26);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);

    localParts.push(header, nameBuf, data);
    centralParts.push(central, nameBuf);
    offset += header.length + nameBuf.length + data.length;
  }

  const local = Buffer.concat(localParts);
  const central = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(local.length, 16);
  return Buffer.concat([local, central, end]);
}

test('docx extraction reads word/document.xml from a ZIP container', () => {
  const xml = '<w:document><w:body>' +
    '<w:p><w:r><w:t>Senior Frontend Developer</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>Built 12 dashboards &amp; shipped TypeScript modules</w:t></w:r></w:p>' +
    '</w:body></w:document>';
  const buffer = makeZip([
    { name: '[Content_Types].xml', data: '<Types/>' },
    { name: 'word/document.xml', data: xml }
  ]);

  const text = extractDocxText(buffer);
  assert.match(text, /Senior Frontend Developer/);
  assert.match(text, /TypeScript modules/);
  assert.match(text, /dashboards & shipped/, 'XML entities should be decoded');
});

test('docx extraction inflates deflate-compressed entries', () => {
  const xml = '<w:document><w:body><w:p><w:t>Compressed resume body</w:t></w:p></w:body></w:document>';
  const raw = Buffer.from(xml, 'utf8');
  const deflated = zlib.deflateRawSync(raw);
  const nameBuf = Buffer.from('word/document.xml', 'utf8');

  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(8, 8); // deflate
  header.writeUInt32LE(deflated.length, 18);
  header.writeUInt32LE(raw.length, 22);
  header.writeUInt16LE(nameBuf.length, 26);
  const local = Buffer.concat([header, nameBuf, deflated]);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(deflated.length, 20);
  central.writeUInt32LE(raw.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  const centralFull = Buffer.concat([central, nameBuf]);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(centralFull.length, 12);
  end.writeUInt32LE(local.length, 16);

  assert.match(extractDocxText(Buffer.concat([local, centralFull, end])), /Compressed resume body/);
});

test('docx extraction rejects an archive without a document body', () => {
  const buffer = makeZip([{ name: 'readme.txt', data: 'nothing here' }]);
  assert.throws(() => extractDocxText(buffer), /not a Word/);
});

test('built-in PDF extractor reads Tj text operators', () => {
  const content = 'BT /F1 12 Tf 72 720 Td (Alex Rahman) Tj T* (Software Engineer with 5 years of experience) Tj ET';
  const pdf = Buffer.from(
    '%PDF-1.4\n1 0 obj\n<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream\nendobj\n%%EOF',
    'latin1'
  );
  const result = extractPdfText(pdf);
  assert.match(result.text, /Alex Rahman/);
  assert.match(result.text, /Software Engineer/);
  assert.ok(result.quality > 0.5, `quality should be usable, got ${result.quality}`);
  assert.equal(detectKind('', 'application/pdf', pdf), 'pdf');
});

test('built-in PDF extractor also handles Flate-compressed streams', () => {
  const content = 'BT /F1 10 Tf 40 700 Td [(Flate) -200 (compressed) -200 (resume text) ] TJ ET';
  const deflated = zlib.deflateSync(Buffer.from(content, 'latin1'));
  const head = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Filter /FlateDecode >>\nstream\n', 'latin1');
  const tail = Buffer.from('\nendstream\nendobj\n%%EOF', 'latin1');
  const result = extractPdfText(Buffer.concat([head, deflated, tail]));

  assert.match(result.text, /Flate/);
  assert.match(result.text, /compressed/);
  assert.match(result.text, /resume text/);
});

test('RTF control words are stripped for text uploads', () => {
  const rtf = '{\\rtf1\\ansi{\\b John Doe}\\par Software Engineer\\par 8 years}';
  const text = stripRtf(rtf);
  assert.match(text, /John Doe/);
  assert.match(text, /Software Engineer/);
  assert.ok(!text.includes('\\par'));
});

test('detectKind() handles extensions, mime types and magic bytes', () => {
  assert.equal(detectKind('cv.pdf', '', null), 'pdf');
  assert.equal(detectKind('notes.txt', '', null), 'text');
  assert.equal(detectKind('', '', Buffer.from([0x50, 0x4b, 0x03, 0x04])), 'docx');
  assert.equal(detectKind('', 'application/pdf', Buffer.from('%PDF-1.4')), 'pdf');
  assert.equal(detectKind('image.png', 'image/png', null), 'unknown');
});
