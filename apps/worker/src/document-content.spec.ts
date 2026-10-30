import { readFile } from 'node:fs/promises';
import {
  toDocumentContent,
  UnreadableDocumentError,
} from './document-content.js';

const fixture = (name: string) =>
  readFile(new URL(`../test/fixtures/${name}`, import.meta.url));

describe('toDocumentContent', () => {
  it('extracts PDF text', async () => {
    await expect(
      toDocumentContent({
        body: await fixture('sample.pdf'),
        contentType: 'application/pdf',
        filename: 'sample.pdf',
      }),
    ).resolves.toEqual({ title: 'sample.pdf', text: 'Hello from PDF' });
  });

  it.each(['text/plain', 'text/markdown; charset=utf-8'])(
    'reads %s as UTF-8',
    async (contentType) => {
      const doc = await toDocumentContent({
        body: Buffer.from('# Héllo\n'),
        contentType,
        filename: 'a.md',
      });

      expect(doc).toEqual({ title: 'a.md', text: '# Héllo' });
    },
  );

  it('extracts DOCX text', async () => {
    const doc = await toDocumentContent({
      body: await fixture('sample.docx'),
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      filename: 'sample.docx',
    });

    expect(doc.text).toBe('Hello from DOCX');
  });

  it('renders PDFs without a text layer as page images', async () => {
    const doc = await toDocumentContent({
      body: await fixture('no-text.pdf'),
      contentType: 'application/pdf',
      filename: 'scan.pdf',
    });

    expect(doc).toEqual({ title: 'scan.pdf', images: [expect.any(String)] });
    const png = Buffer.from((doc as { images: string[] }).images[0], 'base64');
    expect(png.subarray(1, 4).toString()).toBe('PNG');
  });

  it('caps the number of rendered scanned pages', async () => {
    const doc = await toDocumentContent({
      body: await fixture('no-text-12-pages.pdf'),
      contentType: 'application/pdf',
      filename: 'long-scan.pdf',
    });

    expect((doc as { images: string[] }).images).toHaveLength(10);
  });

  it('rejects corrupt PDFs', async () => {
    await expect(
      toDocumentContent({
        body: Buffer.from('not a pdf'),
        contentType: 'application/pdf',
        filename: 'broken.pdf',
      }),
    ).rejects.toBeInstanceOf(UnreadableDocumentError);
  });

  it('rejects other types', async () => {
    await expect(
      toDocumentContent({
        body: Buffer.from('x'),
        contentType: 'image/png',
        filename: 'a.png',
      }),
    ).rejects.toBeInstanceOf(UnreadableDocumentError);
  });
});
