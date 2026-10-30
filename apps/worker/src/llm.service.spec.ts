import { LlmService } from './llm.service.js';

// Ollama streams one JSON object per line.
const ndjson = (...chunks: object[]) =>
  new Response(chunks.map((c) => JSON.stringify(c) + '\n').join(''));

describe('LlmService', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the document to Ollama and joins the streamed answer', async () => {
    fetchMock.mockResolvedValue(
      ndjson(
        { message: { content: 'Hello ' } },
        { message: { content: 'world' } },
        { done: true, done_reason: 'stop' },
      ),
    );

    const answer = await new LlmService().readDocument(
      { title: 'a.txt', text: 'some text' },
      'What is it about?',
    );

    expect(answer).toBe('Hello world');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:11434/api/chat');
    const body = JSON.parse(init!.body as string);
    expect(body).toMatchObject({
      model: 'qwen3-vl:2b',
      stream: true,
      options: { num_ctx: 32768 },
    });
    expect(body.messages[0].content).toMatch(
      /some text[\s\S]*What is it about\?$/,
    );
  });

  it('attaches scanned pages as images', async () => {
    fetchMock.mockResolvedValue(ndjson({ done: true, done_reason: 'stop' }));

    await new LlmService().readDocument(
      { title: 'scan.pdf', images: ['cGFnZTE=', 'cGFnZTI='] },
      'What is it about?',
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
    expect(body.messages[0].images).toEqual(['cGFnZTE=', 'cGFnZTI=']);
    expect(body.messages[0].content).toContain('scan.pdf');
    expect(body.messages[0].content).toContain('What is it about?');
  });

  it('throws on an Ollama error', async () => {
    fetchMock.mockResolvedValue(
      new Response('model "x" not found', { status: 404 }),
    );

    await expect(
      new LlmService().readDocument({ title: 'a.txt', text: 'x' }, 'p'),
    ).rejects.toThrow('Ollama 404: model "x" not found');
  });

  it('throws on an error inside the stream', async () => {
    fetchMock.mockResolvedValue(ndjson({ error: 'out of memory' }));

    await expect(
      new LlmService().readDocument({ title: 'a.txt', text: 'x' }, 'p'),
    ).rejects.toThrow('Ollama: out of memory');
  });
});
