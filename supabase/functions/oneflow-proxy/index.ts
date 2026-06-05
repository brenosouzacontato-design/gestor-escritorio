import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const ALLOWED = ["https://app.omie.com.br", "https://rest.oneflow.com.br"]

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })
  try {
    const { url, method = "GET", headers = {}, body } = await req.json()
    const allowed = ALLOWED.some(base => url?.startsWith(base))
    if (!url || !allowed) {
      return new Response(JSON.stringify({ error: "URL nao permitida: " + url }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } })
    }
    const response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      body: body ? JSON.stringify(body) : undefined,
    })
    const text = await response.text()
    let data
    try { data = JSON.parse(text) } catch { data = { raw: text } }
    return new Response(JSON.stringify(data), { status: response.status, headers: { ...CORS, "Content-Type": "application/json" } })
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...CORS, "Content-Type": "application/json" } })
  }
})
