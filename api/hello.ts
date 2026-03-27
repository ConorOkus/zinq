export function GET() {
  return Response.json({ ok: true, timestamp: Date.now() })
}
