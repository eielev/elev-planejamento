// Elev Mídia — guarda e entrega as imagens e vídeos dos planejamentos (Cloudflare R2).
// GET  /m/<chave>          entrega o arquivo (público, com suporte a vídeo/Range)
// POST /sign               devolve um endereço temporário para enviar um arquivo (só equipe logada)
// POST /delete             apaga arquivos ou uma pasta inteira (só equipe logada)

const KEY_RE = /^[pc][a-z0-9]{12,}\/[a-z0-9]{6,}\.(webp|jpg|jpeg|png|svg|gif|mp4|webm|mov)$/;
const PREFIX_RE = /^[pc][a-z0-9]{12,}\/$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    try {
      if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname.startsWith('/m/')) {
        return await serve(request, env, decodeURIComponent(url.pathname.slice(3)), cors);
      }
      if (request.method === 'POST' && url.pathname === '/sign') {
        await requireTeam(request, env);
        const { key } = await request.json();
        if (!KEY_RE.test(key || '')) return json({ error: 'chave inválida' }, 400, cors);
        return json({ url: await presignPut(env, key, 3600) }, 200, cors);
      }
      if (request.method === 'POST' && url.pathname === '/delete') {
        await requireTeam(request, env);
        const { keys = [], prefix } = await request.json();
        let list = keys.filter(k => KEY_RE.test(k));
        if (prefix && PREFIX_RE.test(prefix)) {
          let cursor;
          do {
            const page = await env.MEDIA.list({ prefix, cursor });
            list.push(...page.objects.map(o => o.key));
            cursor = page.truncated ? page.cursor : undefined;
          } while (cursor);
        }
        for (let i = 0; i < list.length; i += 1000) await env.MEDIA.delete(list.slice(i, i + 1000));
        return json({ deleted: list.length }, 200, cors);
      }
      if (url.pathname === '/') return json({ ok: true, service: 'elev-midia' }, 200, cors);
      return json({ error: 'não encontrado' }, 404, cors);
    } catch (err) {
      const status = err.status || 500;
      return json({ error: status === 401 ? 'login necessário' : 'erro interno' }, status, cors);
    }
  }
};

async function serve(request, env, key, cors) {
  if (!KEY_RE.test(key)) return new Response('Não encontrado', { status: 404, headers: cors });
  const obj = await env.MEDIA.get(key, { range: request.headers, onlyIf: request.headers });
  if (!obj) return new Response('Não encontrado', { status: 404, headers: cors });
  const headers = new Headers(cors);
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  headers.set('accept-ranges', 'bytes');
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  if (!('body' in obj) || !obj.body) return new Response(null, { status: 304, headers });
  let status = 200;
  if (obj.range && request.headers.has('range')) {
    const r = obj.range;
    const start = 'suffix' in r ? obj.size - r.suffix : (r.offset ?? 0);
    const len = 'suffix' in r ? r.suffix : (r.length ?? obj.size - start);
    headers.set('content-range', `bytes ${start}-${start + len - 1}/${obj.size}`);
    headers.set('content-length', String(len));
    status = 206;
  } else {
    headers.set('content-length', String(obj.size));
  }
  return new Response(request.method === 'HEAD' ? null : obj.body, { status, headers });
}

async function requireTeam(request, env) {
  const auth = request.headers.get('authorization') || '';
  if (!auth.startsWith('Bearer ')) throw Object.assign(new Error('auth'), { status: 401 });
  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_ANON_KEY, authorization: auth } });
  if (!r.ok) throw Object.assign(new Error('auth'), { status: 401 });
}

function corsHeaders(request, env) {
  const origin = request.headers.get('origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const h = { 'access-control-allow-methods': 'GET, HEAD, POST, OPTIONS', 'access-control-allow-headers': 'authorization, content-type, range', 'access-control-expose-headers': 'content-length, content-range, etag', 'vary': 'origin' };
  if (allowed.includes(origin) || /^https:\/\/elev-planejamento(-[a-z0-9-]+)?\.vercel\.app$/.test(origin)) h['access-control-allow-origin'] = origin;
  return h;
}
function json(body, status, cors) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json; charset=utf-8' } });
}

/* ---- endereço assinado (AWS SigV4) para enviar direto ao R2 ---- */
const enc = new TextEncoder();
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const sha256 = async s => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
async function hmac(key, data) {
  const k = await crypto.subtle.importKey('raw', typeof key === 'string' ? enc.encode(key) : key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, enc.encode(data));
}
const uriEnc = s => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());

async function presignPut(env, key, expires) {
  const host = `${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const path = `/${env.R2_BUCKET}/${key.split('/').map(uriEnc).join('/')}`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = amzDate.slice(0, 8);
  const scope = `${date}/auto/s3/aws4_request`;
  const params = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${env.R2_ACCESS_KEY_ID}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expires),
    'X-Amz-SignedHeaders': 'host'
  };
  const query = Object.keys(params).sort().map(k => `${uriEnc(k)}=${uriEnc(params[k])}`).join('&');
  const canonical = ['PUT', path, query, `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256(canonical)].join('\n');
  let k = await hmac('AWS4' + env.R2_SECRET_ACCESS_KEY, date);
  k = await hmac(k, 'auto'); k = await hmac(k, 's3'); k = await hmac(k, 'aws4_request');
  const sig = hex(await hmac(k, toSign));
  return `https://${host}${path}?${query}&X-Amz-Signature=${sig}`;
}
