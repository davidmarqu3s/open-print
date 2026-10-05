/*
 * Client API test (web/gs-compress.js).
 *
 * Runs the real client module in Node with a fake `Worker` global that
 * captures postMessage calls, and asserts the payload the browser would
 * receive is valid — in particular that the transfer list contains only
 * Transferable values (ArrayBuffers). This guards against the merge /
 * image-to-PDF bug where `.buffer` was mapped over ArrayBuffers (which
 * produced `undefined` entries and made browser postMessage throw
 * "Failed to convert value to 'object'").
 */

const sent = [];

class FakeWorker {
  postMessage(message, transfer) {
    sent.push({ message, transfer });
  }
  terminate() {}
}
globalThis.Worker = FakeWorker;

const { compressPDF, mergePDFs, pdfToImages, imagesToPdf, splitPdf, dispose } =
  await import('../web/gs-compress.js');

let failures = 0;

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

async function check(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (err) {
    failures++;
    console.error(`✗ ${name}: ${err.message}`);
  }
}

function lastSent() {
  return sent[sent.length - 1];
}

function fakePdf() {
  return new TextEncoder().encode('%PDF-1.4 fake test fixture').buffer;
}

function assertTransferables(transfer, expectedCount) {
  assert(Array.isArray(transfer), 'transfer list should be an array');
  assert(transfer.length === expectedCount, 'transfer list length mismatch');
  for (const entry of transfer) {
    assert(
      entry instanceof ArrayBuffer,
      'transfer entries must be ArrayBuffers (Transferable)'
    );
  }
}

async function run() {
  await check('compress sends a valid payload and transfer list', async () => {
    const file = fakePdf();
    compressPDF({ file, preset: 'balanced', transfer: true }).catch(() => {});
    const { message, transfer } = lastSent();
    assert(message.type === 'compress', 'message type should be compress');
    assert(message.file instanceof ArrayBuffer, 'message.file should be an ArrayBuffer');
    assertTransferables(transfer, 1);
  });

  await check('merge sends a valid payload and transfer list', async () => {
    mergePDFs({ files: [fakePdf(), fakePdf()], pageSize: 'a4', fit: true, transfer: true })
      .catch(() => {});
    const { message, transfer } = lastSent();
    assert(message.type === 'merge', 'message type should be merge');
    assert(
      message.files.every((f) => f instanceof ArrayBuffer),
      'files should be ArrayBuffers'
    );
    assert(message.options.pageSize === 'a4', 'pageSize should pass through');
    assert(message.options.fit === true, 'fit should pass through');
    assertTransferables(transfer, 2);
  });

  await check('merge defaults pageSize=auto and fit=true', async () => {
    mergePDFs({ files: [fakePdf(), fakePdf()], transfer: true }).catch(() => {});
    const { message } = lastSent();
    assert(message.options.pageSize === 'auto', 'pageSize should default to auto');
    assert(message.options.fit === true, 'fit should default to true');
  });

  await check('pdfToImages sends a valid payload and transfer list', async () => {
    pdfToImages({ file: fakePdf(), format: 'png', dpi: 150, transfer: true }).catch(() => {});
    const { message, transfer } = lastSent();
    assert(message.type === 'toImages', 'message type should be toImages');
    assert(message.file instanceof ArrayBuffer, 'message.file should be an ArrayBuffer');
    assert(message.options.format === 'png', 'format should pass through');
    assert(message.options.dpi === 150, 'dpi should pass through');
    assertTransferables(transfer, 1);
  });

  await check('imagesToPdf sends a valid payload and transfer list', async () => {
    const images = [new Uint8Array([1, 2, 3]).buffer, new Uint8Array([4, 5]).buffer];
    imagesToPdf({ images, pageSize: 'letter', fit: false, transfer: true }).catch(() => {});
    const { message, transfer } = lastSent();
    assert(message.type === 'imagesToPdf', 'message type should be imagesToPdf');
    assert(
      message.images.every((f) => f instanceof ArrayBuffer),
      'images should be ArrayBuffers'
    );
    assert(message.options.pageSize === 'letter', 'pageSize should pass through');
    assert(message.options.fit === false, 'fit should pass through');
    assertTransferables(transfer, 2);
  });

  await check('transfer=false disables the transfer list', async () => {
    mergePDFs({ files: [fakePdf(), fakePdf()], transfer: false }).catch(() => {});
    const { transfer } = lastSent();
    assert(transfer === undefined, 'transfer should be undefined when transfer=false');
  });

  await check('splitPdf individual sends a valid payload and transfer list', async () => {
    splitPdf({ file: fakePdf(), mode: 'individual', transfer: true }).catch(() => {});
    const { message, transfer } = lastSent();
    assert(message.type === 'split', 'message type should be split');
    assert(message.file instanceof ArrayBuffer, 'message.file should be an ArrayBuffer');
    assert(message.options.mode === 'individual', 'mode should pass through');
    assertTransferables(transfer, 1);
  });

  await check('splitPdf extract sends pages', async () => {
    splitPdf({ file: fakePdf(), mode: 'extract', pages: '1-3,5', transfer: true }).catch(() => {});
    const { message } = lastSent();
    assert(message.type === 'split', 'message type should be split');
    assert(message.options.mode === 'extract', 'mode should be extract');
    assert(message.options.pages === '1-3,5', 'pages should pass through');
  });

  dispose();

  if (failures > 0) {
    console.error(`\n${failures} client test failure(s).`);
    process.exit(1);
  }
  console.log('\nAll client tests passed.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
