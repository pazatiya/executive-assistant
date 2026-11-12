/** Jimmy's opening message (WhatsApp formatting: *bold*). On Meta it goes out with 3 quick-reply buttons. */
export const WELCOME =
  "ברוכים הבאים ל-*DALOR* 🖤\n\n" +
  "אני ג׳ימי, נציג השירות הדיגיטלי של DALOR.\n\n" +
  "אשמח לסייע בקביעת תורים, בירור פרטים על מוצרים והזמנות, ובכל שאלה נוספת.\n\n" +
  "*כיצד אוכל לסייע היום?*\n\n" +
  "אפשר לבחור באחת מהאפשרויות הבאות או פשוט לכתוב לי במה אוכל לעזור.";

/**
 * Opening message on Facebook Messenger and Instagram — Paz's own wording (12.11.2026).
 * Plain text: those apps show *bold* / **bold** markers literally, so there are none.
 */
export const SOCIAL_WELCOME =
  "ברוכים הבאים ל־DALOR 🖤\n\n" +
  "הבית לגבר – אופנת גברים, מספרה מקצועית וסטייל במקום אחד.\n\n" +
  "תודה שפניתם אלינו! נשמח לסייע בקביעת תורים, מידע על מוצרים, הזמנות ובכל שאלה נוספת.\n\n" +
  "איך נוכל לעזור לכם היום?";

// Meta limits: max 3 buttons, title ≤ 20 chars. The tapped title comes back as the customer's text.
export const WELCOME_BUTTONS = ["💈 קביעת תור למספרה", "🛍️ מוצרים והזמנות", "🎧 שיחה עם נציג"] as const;

/** The tapped button comes back as plain text incl. its emoji — compare on the words only. */
export function buttonKey(text: string | null | undefined): string {
  return (text ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();
}
export const PRODUCTS_BUTTON = buttonKey(WELCOME_BUTTONS[1]);
export const APPT_BUTTON = buttonKey(WELCOME_BUTTONS[0]);
export const APPT_BUTTON_REPLY =
  "בשמחה! 💈\n\n" +
  "אשמח לסייע בקביעת תור למספרת DALOR.\n\n" +
  "*לאיזה יום ושעה תרצו לקבוע תור?*\n\n" +
  "ניתן לציין תאריך ושעה מועדפים, ואבדוק את הזמינות עבורכם.";
export const PRODUCTS_BUTTON_REPLY =
  "בשמחה! 🛍️\n\n" +
  "אשמח לסייע בכל הקשור למוצרים ולהזמנות ב-DALOR.\n\n" +
  "*במה אוכל לעזור?*\n\n" +
  "ניתן לשאול על מוצרים, מידות, מחירים, זמינות במלאי או סטטוס הזמנה.\n\n" +
  "פשוט כתבו לי מה תרצו לדעת ואשמח לסייע.";
