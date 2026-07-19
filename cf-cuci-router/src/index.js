const PUBLIC_ORIGIN = 'https://cuci.jayabina.com';
const PAGES_ORIGIN = 'https://jayaclean-29f.pages.dev';

function rewritePublicUrl(value) {
  return value
    .replaceAll(PAGES_ORIGIN, PUBLIC_ORIGIN)
    .replaceAll('https:\\/\\/jayaclean-29f.pages.dev', 'https:\\/\\/cuci.jayabina.com');
}

export default {
  async fetch(request) {
    const requestUrl = new URL(request.url);
    if (requestUrl.pathname === '/' || requestUrl.pathname === '/index.html') {
      return Response.redirect('https://www.jayabina.com/servis-cuci-tangki-air/', 301);
    }
    if (requestUrl.pathname === '/success.html' || requestUrl.pathname === '/success') {
      return Response.redirect('https://www.jayabina.com/success.html' + requestUrl.search, 301);
    }
    const upstreamUrl = new URL(request.url);
    upstreamUrl.protocol = 'https:';
    upstreamUrl.hostname = 'jayaclean-29f.pages.dev';
    upstreamUrl.port = '';
    const init = {
      method: request.method,
      headers: request.headers,
      redirect: 'manual'
    };
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      init.body = request.body;
    }
    const upstreamResponse = await fetch(upstreamUrl.toString(), init);
    const responseHeaders = new Headers(upstreamResponse.headers);
    for (const name of ['location', 'link', 'content-location', 'refresh']) {
      const value = responseHeaders.get(name);
      if (value) responseHeaders.set(name, rewritePublicUrl(value));
    }
    const contentType = responseHeaders.get('content-type') || '';
    const isText = /text\/|javascript|json|xml|svg/i.test(contentType);
    if (!isText || request.method === 'HEAD') {
      return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers: responseHeaders
      });
    }
    const body = rewritePublicUrl(await upstreamResponse.text());
    responseHeaders.delete('content-length');
    responseHeaders.delete('content-encoding');
    responseHeaders.delete('etag');
    return new Response(body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders
    });
  }
};
