import { Logger } from '@nestjs/common';
import mammoth from 'mammoth';
import { extractText, getDocumentProxy, renderPageAsImage } from 'unpdf';
import { StoredObject } from '@app/storage';

/** Text for text documents; base64 PNG pages for scanned PDFs. */
export type DocumentContent =
  { title: string; text: string } | { title: string; images: string[] };

/** The file can't be turned into content; retrying won't change that. */
export class UnreadableDocumentError extends Error {}

const DOCX =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// Each page image costs roughly 1k tokens at this scale, so the cap keeps a
// scan inside the default num_ctx.
const MAX_SCANNED_PAGES = 10;
const SCAN_RENDER_SCALE = 1.5;

const logger = new Logger('DocumentContent');

export async function toDocumentContent(
  file: StoredObject,
): Promise<DocumentContent> {
  const contentType = file.contentType.split(';')[0].trim().toLowerCase();
  const title = file.filename;

  if (contentType === 'application/pdf') {
    return readPdf(file.body, title);
  }
  const text = (await extractPlainText(contentType, file.body)).trim();
  if (!text) {
    throw new UnreadableDocumentError(`No text found in ${title}`);
  }
  return { title, text };
}

async function readPdf(body: Buffer, title: string): Promise<DocumentContent> {
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    pdf = await getDocumentProxy(new Uint8Array(body));
  } catch (error) {
    // Corrupt or password-protected; parsing again gives the same result.
    throw new UnreadableDocumentError(
      `Cannot open PDF ${title}: ${(error as Error).message}`,
    );
  }

  try {
    const { text } = await extractText(pdf, { mergePages: true });
    if (text.trim()) {
      return { title, text: text.trim() };
    }

    // No text layer, so it's a scan: let the vision model read the pages.
    const pages = Math.min(pdf.numPages, MAX_SCANNED_PAGES);
    if (pdf.numPages > pages) {
      logger.warn(
        `${title} has ${pdf.numPages} scanned pages; only the first ${pages} are read`,
      );
    }
    const images: string[] = [];
    for (let page = 1; page <= pages; page++) {
      const png = await renderPageAsImage(pdf, page, {
        canvasImport: () => import('@napi-rs/canvas'),
        scale: SCAN_RENDER_SCALE,
      });
      images.push(Buffer.from(png).toString('base64'));
    }
    if (!images.length) {
      throw new UnreadableDocumentError(`No pages in ${title}`);
    }
    return { title, images };
  } finally {
    await pdf.loadingTask.destroy();
  }
}

async function extractPlainText(
  contentType: string,
  body: Buffer,
): Promise<string> {
  switch (contentType) {
    case 'text/plain':
    case 'text/markdown':
      return body.toString('utf8');
    case DOCX:
      return (await mammoth.extractRawText({ buffer: body })).value;
    default:
      throw new UnreadableDocumentError(
        `Unsupported content type ${contentType}`,
      );
  }
}
