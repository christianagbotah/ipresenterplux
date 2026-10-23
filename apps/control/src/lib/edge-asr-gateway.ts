const MAX_AUDIO_BYTES = 1_000_000;
const MAX_RESPONSE_BYTES = 128_000;

type AsrEnvironment = Record<string, string | undefined>;
type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function json(error: string, status: number) {
  return Response.json({ ok: false, error }, { status });
}

function workerBase(environment: AsrEnvironment) {
  const raw = environment.IPRESENTERPLUX_ASR_INTERNAL_URL?.trim() || "http://127.0.0.1:8765";
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('invalid_asr_worker_url');
  if (url.protocol === 'http:' && !['127.0.0.1', 'localhost', '::1'].includes(url.hostname))
    throw new Error('insecure_asr_worker_url');
  return url;
}

function upstreamHeaders(request: Request, environment: AsrEnvironment) {
  const sampleRate = request.headers.get('x-ipresenter-sample-rate')?.trim() ?? '';
  const audioFormat = request.headers.get('x-ipresenter-audio-format')?.trim() ?? '';
  if (!/^\d{4,6}$/.test(sampleRate) || Number(sampleRate) < 8000 || Number(sampleRate) > 48000)
    return { error: json('Invalid sample rate', 400) };
  if (audioFormat !== 'pcm_s16le_mono') return { error: json('Unsupported audio format', 400) };

  const headers: Record<string, string> = {
    'Content-Type': 'application/octet-stream',
    'X-IPresenter-Sample-Rate': sampleRate,
    'X-IPresenter-Audio-Format': audioFormat,
  };
  const startedAt = request.headers.get('x-ipresenter-started-at')?.trim();
  if (startedAt) {
    if (!Number.isFinite(Date.parse(startedAt))) return { error: json('Invalid audio timestamp', 400) };
    headers['X-IPresenter-Started-At'] = startedAt;
  }
  const serviceId = request.headers.get('x-ipresenter-service-id')?.trim();
  if (serviceId) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(serviceId))
      return { error: json('Invalid service scope', 400) };
    headers['X-IPresenter-Service-Id'] = serviceId;
  }
  const token = environment.IPRESENTERPLUX_ASR_INTERNAL_TOKEN?.trim();
  if (token) headers.Authorization = `Bearer ${token}`;
  return { headers };
}

export async function forwardEdgeAsrRequest(
  request: Request,
  fetchImpl: FetchLike = fetch,
  environment: AsrEnvironment = process.env,
): Promise<Response> {
  const headerResult = upstreamHeaders(request, environment);
  if ('error' in headerResult) return headerResult.error!;
  const declared = Number(request.headers.get('content-length') || '0');
  if (Number.isFinite(declared) && declared > MAX_AUDIO_BYTES) return json('Audio payload too large', 413);

  const body = await request.arrayBuffer();
  if (body.byteLength === 0) return json('Audio payload is empty', 400);
  if (body.byteLength > MAX_AUDIO_BYTES) return json('Audio payload too large', 413);

  let upstream: Response;
  try {
    const target = new URL('/v1/transcribe', workerBase(environment));
    upstream = await fetchImpl(target, { method: 'POST', headers: headerResult.headers, body });
  } catch {
    return json('Speech recognition worker unavailable', 503);
  }

  const responseBody = await upstream.arrayBuffer();
  if (responseBody.byteLength > MAX_RESPONSE_BYTES) return json('Speech recognition response too large', 502);
  return new Response(responseBody, {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') || 'application/json', 'cache-control': 'no-store' },
  });
}

export async function forwardEdgeAsrHealth(
  fetchImpl: FetchLike = fetch,
  environment: AsrEnvironment = process.env,
): Promise<Response> {
  try {
    const headers: Record<string, string> = {};
    const token = environment.IPRESENTERPLUX_ASR_INTERNAL_TOKEN?.trim();
    if (token) headers.Authorization = `Bearer ${token}`;
    const upstream = await fetchImpl(new URL('/health', workerBase(environment)), { method: 'GET', headers });
    const body = await upstream.arrayBuffer();
    if (body.byteLength > MAX_RESPONSE_BYTES) return json('Speech recognition health response too large', 502);
    return new Response(body, {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') || 'application/json', 'cache-control': 'no-store' },
    });
  } catch {
    return json('Speech recognition worker unavailable', 503);
  }
}
