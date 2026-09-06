import { ModelRouter } from "@/lib/ai/model-router";
import { AUTO_REPLY_INTENTS } from "@/lib/approval/engine";

/**
 * Triage of an inbound customer message (WhatsApp / IG / FB).
 * Same spirit as classifyEmail: sender/keyword heuristics + an LLM pass.
 *
 * The `intent` bucket is what decides autonomy. Only the closed
 * AUTO_REPLY_INTENTS list may ever be answered without יאיר/פז.
 */
export type MessageClassification =
  | "lead"
  | "question"
  | "complaint"
  | "spam"
  | "praise"
  | "needs_human"
  | "other";

export type IntentCategory =
  // ── routine, answerable on our own ──────────────────────────
  | "opening_hours"
  | "location"
  | "barber_pricelist"
  | "appointment_availability"
  | "appointment_confirm"
  // ── always a person decides ─────────────────────────────────
  | "clothing_availability" // IRON RULE: catalog is not stock — never say "we don't have it"
  | "price_or_discount"
  | "appointment_change" // reschedule / cancel an existing booking
  | "order_status"
  | "complaint"
  | "other";

export interface MessageTriage {
  classification: MessageClassification;
  sentiment: "positive" | "neutral" | "negative";
  priority: "low" | "normal" | "high" | "urgent";
  intent: IntentCategory;
  /** true only when intent ∈ AUTO_REPLY_INTENTS and nothing else blocks it */
  canAutoReply: boolean;
  summary: string;
}

const HE_SYSTEM = `אתה מסווג הודעה נכנסת מלקוח לעסק DALOR (מספרה + חנות בגדים לגבר) עבור מזכירה דיגיטלית.
החזר JSON בלבד:
{
 "classification": "lead"|"question"|"complaint"|"spam"|"praise"|"needs_human"|"other",
 "sentiment": "positive"|"neutral"|"negative",
 "priority": "low"|"normal"|"high"|"urgent",
 "intent": "opening_hours"|"location"|"barber_pricelist"|"appointment_availability"|"appointment_confirm"|"clothing_availability"|"price_or_discount"|"appointment_change"|"order_status"|"complaint"|"other",
 "summary": "משפט אחד בעברית"
}
כללי intent:
- "opening_hours": שואל מתי פתוח / שעות.
- "location": שואל כתובת / איפה / חניה / איך מגיעים.
- "barber_pricelist": שואל כמה עולה תספורת / זקן / החלקה — מחירון מספרה קבוע בלבד.
- "appointment_availability": רוצה לדעת אם יש תור פנוי / לתאם תור חדש.
- "appointment_confirm": מאשר תור שכבר קיים / שואל מתי התור שלו.
- "clothing_availability": שואל אם יש פריט לבוש / מידה / צבע / מלאי בגדים. חשוב: תמיד intent הזה גם אם נראה פשוט.
- "price_or_discount": שואל מחיר של בגד, הנחה, מבצע, מיקוח, קופון.
- "appointment_change": רוצה לבטל / להזיז תור קיים.
- "order_status": שואל על הזמנה שביצע / משלוח.
- "complaint": מתלונן, כועס, מאוכזב.
- "other": כל השאר.`;

const KW = {
  hours: /שעות|מתי פתוח|פתוחים|עד מתי|באיזה שעות|open|hours/i,
  location: /כתובת|איפה אתם|מיקום|חניה|איך מגיעים|ווייז|waze|address|location/i,
  barberPrice: /כמה עולה.*(תספורת|תור|זקן|החלק)|מחיר.*(תספורת|זקן)|תספורת.*כמה/i,
  apptNew: /תור|לתאם|לקבוע|פנוי|מקום|appointment|slot|book/i,
  apptConfirm: /התור שלי|מתי התור|לאשר את התור|מאשר.*תור/i,
  apptChange: /לבטל.*תור|להזיז.*תור|לדחות.*תור|cancel|reschedule/i,
  clothing: /חולצה|מכנס|ג'?ינס|נעל|חגור|מעיל|סווצ'?ר|טישרט|בגד|מידה|צבע|size|shirt|pants|jacket|מלאי|יש לכם.*ב/i,
  price: /כמה עולה|מחיר|הנחה|מבצע|קופון|זול|ביוקר|price|discount|deal/i,
  order: /הזמנה|משלוח|חבילה|הגיע|order|shipment|delivery/i,
  complaint: /גרוע|נורא|מאוכזב|כועס|לא מרוצה|בושה|תלונה|החזר כספי|refund|terrible|awful/i,
  praise: /תודה רבה|מהמם|מדהים|אלופים|כפרה|פצצה|thank you|amazing|great/i,
};

function heuristicTriage(text: string): MessageTriage {
  const t = text.toLowerCase();
  let intent: IntentCategory = "other";
  let classification: MessageClassification = "question";

  if (KW.complaint.test(t)) {
    intent = "complaint";
    classification = "complaint";
  } else if (KW.clothing.test(t)) {
    intent = "clothing_availability";
    classification = "lead";
  } else if (KW.price.test(t)) intent = "price_or_discount";
  else if (KW.apptChange.test(t)) intent = "appointment_change";
  else if (KW.apptConfirm.test(t)) intent = "appointment_confirm";
  else if (KW.barberPrice.test(t)) intent = "barber_pricelist";
  else if (KW.apptNew.test(t)) {
    intent = "appointment_availability";
    classification = "lead";
  } else if (KW.hours.test(t)) intent = "opening_hours";
  else if (KW.location.test(t)) intent = "location";
  else if (KW.order.test(t)) intent = "order_status";

  const sentiment: MessageTriage["sentiment"] = KW.complaint.test(t)
    ? "negative"
    : KW.praise.test(t)
      ? "positive"
      : "neutral";
  if (KW.praise.test(t)) classification = "praise";

  const priority: MessageTriage["priority"] =
    classification === "complaint" ? "urgent" : classification === "lead" ? "high" : "normal";

  return {
    classification,
    sentiment,
    priority,
    intent,
    canAutoReply: AUTO_REPLY_INTENTS.has(intent),
    summary: `[היוריסטיקה] ${intent}`,
  };
}

export async function triageMessage(input: {
  text: string;
  authorName?: string | null;
  channel: string;
}): Promise<MessageTriage> {
  const base = heuristicTriage(input.text);

  const route = ModelRouter.resolve("classification");
  if (route.mock) return base;

  try {
    const res = await ModelRouter.complete("classification", {
      system: HE_SYSTEM,
      json: true,
      messages: [
        {
          role: "user",
          content: `ערוץ: ${input.channel}\nשם: ${input.authorName ?? "לא ידוע"}\nהודעה: ${input.text}`,
        },
      ],
    });
    const p = JSON.parse(res.text) as Partial<MessageTriage>;
    const intent = (p.intent as IntentCategory) ?? base.intent;
    const classification = (p.classification as MessageClassification) ?? base.classification;
    const sentiment = (p.sentiment as MessageTriage["sentiment"]) ?? base.sentiment;
    // Iron rule + safety: complaints and anything non-whitelisted never auto-reply.
    const canAutoReply =
      AUTO_REPLY_INTENTS.has(intent) && classification !== "complaint" && sentiment !== "negative";
    return {
      classification,
      sentiment,
      priority: (p.priority as MessageTriage["priority"]) ?? base.priority,
      intent,
      canAutoReply,
      summary: p.summary ?? base.summary,
    };
  } catch {
    return base;
  }
}
