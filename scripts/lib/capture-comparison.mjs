import { readFileSync, writeFileSync } from 'node:fs';
import pngjs from 'pngjs';

const { PNG } = pngjs;

// Geometry is the release gate because it is stable and directly actionable. Raster metrics below
// remain diagnostic: small backend-specific antialiasing differences must not decide design quality.
export function compareGeometry(browserMetadata, nativeMetadata, tolerancePx = 2) {
  const browser = browserMetadata.toggle;
  const native = nativeMetadata.toggle;
  if (!browser || !native) {
    throw new Error('Both metadata documents must contain toggle geometry.');
  }
  const differences = {
    xPx: Math.abs(browser.xPx - native.xPx),
    yPx: Math.abs(browser.yPx - native.yPx),
    widthPx: Math.abs(browser.widthPx - native.widthPx),
    heightPx: Math.abs(browser.heightPx - native.heightPx),
  };
  return {
    tolerancePx,
    differences,
    maximumDifferencePx: Math.max(...Object.values(differences)),
    passed: Object.values(differences).every((difference) => difference <= tolerancePx),
  };
}

export function compareSourceIdentity(browserMetadata, nativeMetadata) {
  const browserSha256 = browserMetadata.sourceSha256;
  const nativeSha256 = nativeMetadata.sourceSha256;
  // A matching digest proves both executables were compiled from the same starter implementation
  // and public header. Without it, a geometry pass could compare unrelated source revisions.
  return {
    browserSha256,
    nativeSha256,
    passed:
      typeof browserSha256 === 'string' &&
      /^[a-f0-9]{64}$/.test(browserSha256) &&
      browserSha256 === nativeSha256,
  };
}

export function comparePngFiles(browserPath, nativePath, differenceOutputPath) {
  const browser = PNG.sync.read(readFileSync(browserPath));
  const native = PNG.sync.read(readFileSync(nativePath));
  if (browser.width !== native.width || browser.height !== native.height) {
    return {
      passedDimensions: false,
      browserDimensions: [browser.width, browser.height],
      nativeDimensions: [native.width, native.height],
      changedPixels: null,
      meanAbsoluteDifference: null,
    };
  }

  // PNGJS exposes tightly packed RGBA bytes. The difference image stores absolute channel deltas;
  // forcing alpha to opaque makes subtle RGB differences visible in ordinary image viewers.
  const difference = new PNG({ width: browser.width, height: browser.height });
  let changedPixels = 0;
  let absoluteDifference = 0;
  let perceptualDifference = 0;
  for (let index = 0; index < browser.data.length; index += 4) {
    let pixelChanged = false;
    for (let channel = 0; channel < 4; channel += 1) {
      const delta = Math.abs(browser.data[index + channel] - native.data[index + channel]);
      difference.data[index + channel] = delta;
      absoluteDifference += delta;
      pixelChanged ||= delta !== 0;
    }
    if (pixelChanged) {
      changedPixels += 1;
    }
    perceptualDifference += yiqDifference(
      browser.data[index],
      browser.data[index + 1],
      browser.data[index + 2],
      native.data[index],
      native.data[index + 1],
      native.data[index + 2],
    );
    difference.data[index + 3] = 255;
  }

  writeFileSync(differenceOutputPath, PNG.sync.write(difference));
  return {
    passedDimensions: true,
    browserDimensions: [browser.width, browser.height],
    nativeDimensions: [native.width, native.height],
    changedPixels,
    changedPixelRatio: changedPixels / (browser.width * browser.height),
    meanAbsoluteDifference: absoluteDifference / browser.data.length,
    perceptual: {
      metric: 'weighted-yiq-v1',
      meanNormalizedDifference: perceptualDifference / (browser.width * browser.height),
      similarityScore: 1 - perceptualDifference / (browser.width * browser.height),
    },
  };
}

function yiqDifference(redA, greenA, blueA, redB, greenB, blueB) {
  // Convert the RGB delta into YIQ-like luminance/chrominance axes, then apply perceptual weights.
  // Human vision is more sensitive to luminance (Y) than the I/Q color channels, so this diagnostic
  // is more meaningful than treating every RGB axis equally. Inputs are 8-bit sRGB channel values;
  // division by 255 normalizes the weighted distance to [0, 1]. This deliberately remains a
  // diagnostic rather than a pass/fail gate, as required by the PRD.
  const redDelta = redA - redB;
  const greenDelta = greenA - greenB;
  const blueDelta = blueA - blueB;
  const yDelta = 0.299 * redDelta + 0.587 * greenDelta + 0.114 * blueDelta;
  const iDelta = 0.596 * redDelta - 0.274 * greenDelta - 0.322 * blueDelta;
  const qDelta = 0.211 * redDelta - 0.523 * greenDelta + 0.312 * blueDelta;
  const weightedDistance = Math.sqrt(
    0.5053 * yDelta * yDelta + 0.299 * iDelta * iDelta + 0.1957 * qDelta * qDelta,
  );
  return Math.min(weightedDistance / 255, 1);
}
