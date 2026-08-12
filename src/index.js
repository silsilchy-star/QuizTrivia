export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/score') {
      if (request.method === 'GET') {
        const score = parseInt(await env.SCORE_KV.get('score'), 10) || 0;
        return Response.json({ score });
      }

      if (request.method === 'POST') {
        const current = parseInt(await env.SCORE_KV.get('score'), 10) || 0;
        const next = current + 1;
        await env.SCORE_KV.put('score', String(next));
        return Response.json({ score: next });
      }

      return new Response('Method Not Allowed', { status: 405 });
    }

    return env.ASSETS.fetch(request);
  },
};
