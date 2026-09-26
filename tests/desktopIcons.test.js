import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { DesktopIcons, normalizeDesktopScan } from '../src/main/DesktopIcons.js';

// 125% scaling: physical pixels / 1.25 = DIPs.
const toDipRect = ({ x, y, width, height }) => ({ x: x / 1.25, y: y / 1.25, width: width / 1.25, height: height / 1.25 });
const workArea = { x: 0, y: 0, width: 1536, height: 816 };
const rawIcon = (overrides = {}) => ({ Id: '0a43e807de8b', Name: 'Projects', Kind: 'folder', X: 17, Y: 124, Width: 95, Height: 122, Occluded: false, ...overrides });

describe('normalizeDesktopScan', () => {
  test('converts physical pixels to window coordinates in DIPs', () => {
    const scan = normalizeDesktopScan({ Visible: true, Icons: [rawIcon()] }, { toDipRect, workArea });
    assert.deepEqual(scan.icons, [{ id: '0a43e807de8b', name: 'Projects', kind: 'folder', x: 14, y: 99, width: 76, height: 98, occluded: false }]);
  });

  test('is relative to the work area (e.g. taskbar at the top)', () => {
    const scan = normalizeDesktopScan({ Visible: true, Icons: [rawIcon({ Y: 124 })] }, { toDipRect, workArea: { ...workArea, y: 48, height: 768 } });
    assert.equal(scan.icons[0].y, 51);
  });

  test('reports hidden desktop icons', () => {
    assert.deepEqual(normalizeDesktopScan({ Visible: false, Icons: [] }, { toDipRect, workArea }), { available: true, visible: false, icons: [] });
  });

  test('drops malformed icons and icons outside the work area', () => {
    const scan = normalizeDesktopScan({
      Visible: true,
      Icons: [
        rawIcon({ Id: 'C:\\Users\\me\\secret.txt' }), // ids must be anonymous hashes
        rawIcon({ Kind: 'program' }),
        rawIcon({ X: Number.NaN }),
        rawIcon({ Y: 990 }), // under the taskbar
        rawIcon({ Name: 'ok\u0007name' }),
      ],
    }, { toDipRect, workArea });
    assert.deepEqual(scan.icons.map((icon) => icon.name), ['okname']);
  });

  test('rejects output that is not a scan', () => {
    assert.throws(() => normalizeDesktopScan(null, { toDipRect, workArea }));
  });
});

describe('DesktopIcons', () => {
  const helperWith = (request, available = true) => ({ available, unavailableReason: 'blocked by policy', request });

  test('scans through the helper and remembers the last result', async () => {
    const desktopIcons = new DesktopIcons({
      helper: helperWith(async () => ({ Visible: true, Icons: [rawIcon()] })),
      toDipRect,
      getWorkArea: () => workArea,
    });
    assert.equal(desktopIcons.last, null);
    const scan = await desktopIcons.scan();
    assert.equal(scan.available, true);
    assert.equal(scan.icons.length, 1);
    assert.equal(desktopIcons.last, scan);
    assert.ok(Number.isFinite(scan.time));
  });

  test('simultaneous scans share one helper request', async () => {
    let calls = 0;
    const desktopIcons = new DesktopIcons({
      helper: helperWith(async () => { calls += 1; return { Visible: true, Icons: [] }; }),
      toDipRect,
      getWorkArea: () => workArea,
    });
    await Promise.all([desktopIcons.scan(), desktopIcons.scan(), desktopIcons.scan()]);
    assert.equal(calls, 1);
  });

  test('turns helper failures into an "unavailable" answer instead of throwing', async () => {
    const failing = new DesktopIcons({ helper: helperWith(async () => { throw new Error('boom'); }), toDipRect, getWorkArea: () => workArea });
    assert.deepEqual((await failing.scan()).available, false);

    const blocked = new DesktopIcons({ helper: helperWith(null, false), toDipRect, getWorkArea: () => workArea });
    const scan = await blocked.scan();
    assert.equal(scan.available, false);
    assert.equal(scan.reason, 'blocked by policy');
  });
});
