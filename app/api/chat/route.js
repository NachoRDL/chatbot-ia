import Groq from "groq-sdk"
import { createClient } from "@supabase/supabase-js"

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

export async function POST(req) {
  const { mensaje, historial, negocioId } = await req.json()

  console.log("ID recibido:", negocioId)

  const { data: negocio, error } = await supabase
    .from("negocios")
    .select("*")
    .eq("id", negocioId)
    .single()

  console.log("Negocio:", negocio?.nombre, "Error:", error)

  if (!negocio || !negocio.bot_activo) {
    return Response.json({ respuesta: "El asistente no está disponible en este momento.", accion: null })
  }

  // Construir FAQs para el prompt
  const faqsTexto = Array.isArray(negocio.faqs) && negocio.faqs.length > 0
    ? `\nPreguntas frecuentes (responde EXACTAMENTE así cuando te pregunten esto):\n` +
      negocio.faqs.map(f => `P: ${f.pregunta}\nR: ${f.respuesta}`).join("\n")
    : ""

  // Link de agendamiento
  const linkAgenda = negocio.link_agendamiento
    ? `\nCuando el usuario quiera agendar, comparte este enlace: ${negocio.link_agendamiento}`
    : ""

  const systemPrompt = `
${negocio.system_prompt || "Eres un asistente virtual amable y profesional."}

Información del negocio:
- Nombre: ${negocio.nombre}
- Horario: ${negocio.horario || "No especificado"}
- Servicios: ${negocio.servicios || "No especificado"}
- Dirección: ${negocio.direccion || "No especificado"}
- Teléfono: ${negocio.telefono || "No especificado"}
${faqsTexto}
${linkAgenda}

Si el usuario quiere agendar, incluye ACTION:AGENDAR al inicio de tu respuesta.
Si capturas un lead, incluye ACTION:LEAD al inicio.
Responde siempre en español. Sé amable y breve.
`

  const response = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [
      { role: "system", content: systemPrompt },
      ...historial,
      { role: "user", content: mensaje }
    ],
    max_tokens: 500
  })

  const texto = response.choices[0].message.content
  let accion = null
  if (texto.startsWith("ACTION:AGENDAR")) accion = "agendar"
  if (texto.startsWith("ACTION:LEAD")) accion = "lead"

  const respuesta = texto.replace(/^ACTION:\w+\s*/, "").trim()

  // Guardar conversación
  const mensajesActualizados = [
    ...historial,
    { role: "user", content: mensaje },
    { role: "assistant", content: respuesta }
  ]

  await supabase.from("conversaciones").upsert({
    negocio_id: negocioId,
    mensajes: mensajesActualizados,
    updated_at: new Date().toISOString()
  })

  if (accion === "lead") {
    await supabase.from("leads").insert({
      negocio_id: negocioId,
      mensaje: mensaje
    })
  }

  return Response.json({ respuesta, accion })
}