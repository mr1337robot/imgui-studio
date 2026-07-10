import { compareGeometry, compareSourceIdentity } from './lib/capture-comparison.mjs';

const canonical = { toggle: { xPx: 500, yPx: 260, widthPx: 58, heightPx: 30 } };
const withinTolerance = { toggle: { xPx: 501.5, yPx: 258, widthPx: 58, heightPx: 30 } };
const deliberatelyShifted = { toggle: { xPx: 508, yPx: 260, widthPx: 58, heightPx: 30 } };

if (!compareGeometry(canonical, withinTolerance, 2).passed) {
  throw new Error('Geometry comparator rejected the two-pixel acceptance boundary.');
}
if (compareGeometry(canonical, deliberatelyShifted, 2).passed) {
  throw new Error('Geometry comparator accepted the deliberately shifted negative fixture.');
}
const sourceSha256 = 'a'.repeat(64);
if (!compareSourceIdentity({ sourceSha256 }, { sourceSha256 }).passed) {
  throw new Error('Source identity comparator rejected matching canonical source hashes.');
}
if (compareSourceIdentity({ sourceSha256 }, { sourceSha256: 'b'.repeat(64) }).passed) {
  throw new Error('Source identity comparator accepted different source hashes.');
}
console.log('Capture comparison positive and deliberately shifted negative fixtures passed.');
