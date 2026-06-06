exports.handler = async function(event) {
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  }
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" }
  try {
    const { url, method, authorization, bodyData } = JSON.parse(event.body)
    const allowed = url && (url.startsWith("https://app.omie.com.br") || url.startsWith("https://rest.oneflow.com.br"))
    if (!allowed) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "URL nao permitida" }) }
    const headers = { "Content-Type": "application/json" }
    if (authorization) headers["Authorization"] = "Bearer " + authorization
    const fetchOpts = { method: method || "GET", headers: headers }
    if (bodyData) fetchOpts.body = JSON.stringify(bodyData)
    const res = await fetch(url, fetchOpts)
    const text = await res.text()
    let data
    try { data = JSON.parse(text) } catch(e) { data = { error: "Invalid JSON", raw: text.slice(0,200) } }
    return { statusCode: res.status, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(data) }
  } catch(e) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: e.message }) }
  }
}
