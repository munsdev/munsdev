// Reverse proxy: reflectingpool.us / www.reflectingpool.us -> the Webflow
// site's default hosting hostname (reflecting-pool-us.webflow.io). This
// lets the custom domain work without going through Webflow's own paid
// "connect a custom domain" flow -- Cloudflare fronts the domain and this
// Worker forwards every request to Webflow's always-available *.webflow.io
// host, rewriting the outbound Host header so Webflow resolves the right
// site.

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    url.protocol = "https:";
    url.hostname = env.UPSTREAM_HOST;
    url.port = "";

    const upstreamRequest = new Request(url.toString(), request);
    upstreamRequest.headers.set("Host", env.UPSTREAM_HOST);

    return fetch(upstreamRequest);
  },
};
