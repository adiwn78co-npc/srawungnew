import { jsPDF } from 'jspdf';
import { domToCanvas } from 'modern-screenshot';

export interface DownloadPdfOptions {
  element?: HTMLElement | null;
  selector?: string;
  filename: string;
  paperFormat?: 'a4' | 'legal';
  orientation?: 'portrait' | 'landscape';
  marginMm?: number;
}

interface CanvasRegion {
  topPx: number;
  bottomPx: number;
}

function sanitizePdfFilename(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/\.pdf$/i, '')
    .replace(/[^a-zA-Z0-9-_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return `${cleaned || 'Dokumen_WIJNA'}.pdf`;
}

/**
 * Collects DOM-based bounding regions (converted to canvas Y coordinates)
 * for tables (including their immediate section headers) and smaller atomic blocks (rows, list items, paragraphs)
 * so tables are never cut across pages if they fit intact on the next page.
 */
function collectKeepTogetherRegions(
  targetEl: HTMLElement,
  canvasHeight: number
): {
  tableRegions: CanvasRegion[];
  atomicRegions: CanvasRegion[];
} {
  const targetRect = targetEl.getBoundingClientRect();
  if (targetRect.height <= 0) {
    return { tableRegions: [], atomicRegions: [] };
  }

  const scaleY = canvasHeight / targetRect.height;
  const toCanvasY = (domY: number) =>
    Math.max(0, Math.min(canvasHeight, Math.round((domY - targetRect.top) * scaleY)));

  const sectionHeaders = Array.from(
    targetEl.querySelectorAll<HTMLElement>('.bg-\\[\\#CCCCCC\\], h1, h2, h3')
  ).map((el) => el.getBoundingClientRect());

  const tableRegions: CanvasRegion[] = [];
  const rawTableUnits = new Set<HTMLElement>();

  // 1. Collect all tables (or their bordered Rundown wrapper if inside one) and explicit keep-together blocks
  targetEl.querySelectorAll<HTMLElement>('table, .pdf-keep-together').forEach((el) => {
    const rundownWrapper = el.closest<HTMLElement>('.border.border-black');
    if (rundownWrapper && targetEl.contains(rundownWrapper) && rundownWrapper !== targetEl) {
      rawTableUnits.add(rundownWrapper);
    } else {
      rawTableUnits.add(el);
    }
  });

  rawTableUnits.forEach((unitEl) => {
    const rect = unitEl.getBoundingClientRect();
    if (rect.height <= 0) return;

    let topDom = rect.top;
    const bottomDom = rect.bottom;

    // If a section header bar (.bg-[#CCCCCC]) is immediately above this table (within 50px),
    // include that header in the region so the header is never orphaned at the bottom of a page.
    for (const hdr of sectionHeaders) {
      const gap = topDom - hdr.bottom;
      if (gap >= -4 && gap <= 50) {
        topDom = Math.min(topDom, hdr.top);
      }
    }

    // Also check if there is a short bold label right above the table (e.g. "Tujuan Khusus")
    const prevEl = unitEl.previousElementSibling as HTMLElement | null;
    if (prevEl) {
      const prevRect = prevEl.getBoundingClientRect();
      if (prevRect.height > 0 && prevRect.height <= 40 && topDom - prevRect.bottom <= 20) {
        topDom = Math.min(topDom, prevRect.top);
      }
    }

    const topPx = Math.max(0, toCanvasY(topDom) - 6);
    const bottomPx = Math.min(canvasHeight, toCanvasY(bottomDom) + 6);

    if (bottomPx > topPx + 10) {
      tableRegions.push({ topPx, bottomPx });
    }
  });

  tableRegions.sort((a, b) => a.topPx - b.topPx);

  // 2. Collect smaller atomic blocks (table rows, list items, paragraphs, headings)
  // in case a single massive table exceeds an entire page or page break lands in text
  const atomicRegions: CanvasRegion[] = [];
  targetEl.querySelectorAll<HTMLElement>('tr, li, p, .bg-\\[\\#CCCCCC\\]').forEach((el) => {
    const rect = el.getBoundingClientRect();
    if (rect.height <= 0) return;
    const topPx = Math.max(0, toCanvasY(rect.top) - 2);
    const bottomPx = Math.min(canvasHeight, toCanvasY(rect.bottom) + 2);
    if (bottomPx > topPx + 4) {
      atomicRegions.push({ topPx, bottomPx });
    }
  });

  atomicRegions.sort((a, b) => a.topPx - b.topPx);

  return { tableRegions, atomicRegions };
}

/**
 * Finds a clean horizontal break row near targetY (scanning upwards) that is mostly white
 * so multi-page PDF slicing does not cut through the middle of a line of text.
 */
function findCleanBreakY(
  ctx: CanvasRenderingContext2D,
  width: number,
  startY: number,
  targetY: number,
  totalHeight: number
): number {
  if (targetY >= totalHeight) return totalHeight;

  const minScanY = Math.max(startY + 120, targetY - 100);
  const scanHeight = targetY - minScanY;
  if (scanHeight <= 4) return targetY;

  try {
    const imgData = ctx.getImageData(0, minScanY, width, scanHeight);
    const data = imgData.data;

    // Scan from bottom (targetY - 1) upwards to minScanY
    for (let row = scanHeight - 1; row >= 0; row--) {
      let nonWhitePixels = 0;
      const rowOffset = row * width * 4;
      for (let x = 0; x < width; x += 4) {
        const idx = rowOffset + x * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        if (r < 245 || g < 245 || b < 245) {
          nonWhitePixels++;
          if (nonWhitePixels > 2) break;
        }
      }
      if (nonWhitePixels === 0) {
        return minScanY + row;
      }
    }
  } catch {
    // Fallback to targetY if getImageData fails
  }

  return targetY;
}

export async function downloadElementAsPdf({
  element,
  selector = '.tor-formal-print-sheet',
  filename,
  paperFormat = 'legal',
  orientation = 'portrait',
  marginMm = 7,
}: DownloadPdfOptions): Promise<void> {
  let targetEl: HTMLElement | null = element || null;

  if (!targetEl) {
    const candidates = Array.from(document.querySelectorAll<HTMLElement>(selector));
    for (let i = candidates.length - 1; i >= 0; i--) {
      if (candidates[i].offsetParent !== null || candidates[i].getBoundingClientRect().height > 0) {
        targetEl = candidates[i];
        break;
      }
    }
    if (!targetEl && candidates.length > 0) {
      targetEl = candidates[candidates.length - 1];
    }
  }

  if (!targetEl) {
    throw new Error('Elemen dokumen untuk diunduh sebagai PDF tidak ditemukan.');
  }

  const sourceCanvas = await domToCanvas(targetEl, {
    scale: 2,
    backgroundColor: '#ffffff',
  });

  const { tableRegions, atomicRegions } = collectKeepTogetherRegions(
    targetEl,
    sourceCanvas.height
  );

  const pdf = new jsPDF({
    orientation,
    unit: 'mm',
    format: paperFormat,
    compress: true,
  });

  const pageWidthMm = pdf.internal.pageSize.getWidth();
  const pageHeightMm = pdf.internal.pageSize.getHeight();
  const contentWidthMm = pageWidthMm - marginMm * 2;
  const maxPageContentHeightMm = pageHeightMm - marginMm * 2;

  const canvasWidth = sourceCanvas.width;
  const canvasHeight = sourceCanvas.height;

  // Pixels per mm at current width scale
  const pxPerMm = canvasWidth / contentWidthMm;
  const maxSliceHeightPx = Math.floor(maxPageContentHeightMm * pxPerMm);

  const sourceCtx = sourceCanvas.getContext('2d');
  let currentY = 0;
  let pageIndex = 0;

  while (currentY < canvasHeight) {
    if (pageIndex > 0) {
      pdf.addPage(paperFormat, orientation);
    }

    const rawNextY = Math.min(currentY + maxSliceHeightPx, canvasHeight);
    let nextY = rawNextY;

    if (rawNextY < canvasHeight) {
      // 1. Check if any table (and its section header) is cut across rawNextY.
      // If the table starts below currentY and can fit intact on the next page,
      // break right BEFORE the table so the whole table moves intact to the next page.
      const straddlingTable = tableRegions.find(
        (reg) =>
          reg.topPx > currentY + 30 &&
          reg.topPx < rawNextY &&
          reg.bottomPx > rawNextY &&
          reg.bottomPx - reg.topPx <= maxSliceHeightPx * 0.96
      );

      if (straddlingTable) {
        nextY = straddlingTable.topPx;
      } else {
        // 2. Otherwise check if any atomic row/paragraph/list-item is cut across rawNextY
        const straddlingAtomic = atomicRegions.find(
          (reg) =>
            reg.topPx > currentY + 20 &&
            reg.topPx < rawNextY &&
            reg.bottomPx > rawNextY &&
            reg.bottomPx - reg.topPx <= maxSliceHeightPx * 0.5
        );

        if (straddlingAtomic) {
          nextY = straddlingAtomic.topPx;
        } else if (sourceCtx) {
          nextY = findCleanBreakY(sourceCtx, canvasWidth, currentY, rawNextY, canvasHeight);
        }
      }
    }

    // Safety guard to ensure forward progress
    if (nextY <= currentY + 20) {
      nextY = rawNextY;
    }

    const sliceHeightPx = Math.max(1, nextY - currentY);
    const sliceHeightMm = sliceHeightPx / pxPerMm;

    const pageCanvas = document.createElement('canvas');
    pageCanvas.width = canvasWidth;
    pageCanvas.height = sliceHeightPx;
    const pageCtx = pageCanvas.getContext('2d');

    if (pageCtx) {
      pageCtx.fillStyle = '#ffffff';
      pageCtx.fillRect(0, 0, canvasWidth, sliceHeightPx);
      pageCtx.drawImage(
        sourceCanvas,
        0,
        currentY,
        canvasWidth,
        sliceHeightPx,
        0,
        0,
        canvasWidth,
        sliceHeightPx
      );

      const imgDataUrl = pageCanvas.toDataURL('image/jpeg', 0.95);
      pdf.addImage(
        imgDataUrl,
        'JPEG',
        marginMm,
        marginMm,
        contentWidthMm,
        sliceHeightMm,
        undefined,
        'FAST'
      );
    }

    currentY = nextY;
    pageIndex++;
  }

  pdf.save(sanitizePdfFilename(filename));
}
