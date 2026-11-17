/* Keeps money talk off Connect, to protect students from scams.
   The same rule runs in the database (supabase/schema.sql, no_payment_details),
   so it holds even if someone bypasses the app. */

const PAYMENT_TALK = new RegExp(
  [
    String.raw`\baza\b`,
    String.raw`\bacct\b`,
    String.raw`\ba\/c\b`,
    // account number / acc no / account details / ac info
    String.raw`\b(?:account|acc|ac)\.?\s*(?:number|no|num|details?|info)\b`,
    // bank account / bank acct / bank details / bank no
    String.raw`\bbank\s*(?:account|acct|acc|a\/c|details?|info|number|no)\b`,
    // send your account / send me your bank / send ur acc
    String.raw`\bsend\s+(?:me\s+)?(?:your\s+|ur\s+)?(?:bank|account|acct|acc)\b`,
    // payment apps
    String.raw`\b(?:opay|palmpay|moniepoint)\b`,
    // pay into my / transfer to my
    String.raw`\b(?:pay|transfer)\s+(?:it\s+|the\s+money\s+)?(?:in)?to\s+my\b`,
    // a 10-digit account number
    String.raw`(?:^|\D)\d{10}(?:\D|$)`,
  ].join('|'),
  'i',
);

export const PAYMENT_NOTE =
  'To protect everyone from scams, Connect doesn’t allow payment or bank details, like “aza”, “send your account” or an account number. Keep payments off Connect.';

export function hasPaymentTalk(...texts: (string | null | undefined)[]) {
  return texts.some((t) => Boolean(t && PAYMENT_TALK.test(t)));
}

/** Throws the friendly note when text contains payment details */
export function assertNoPaymentTalk(...texts: (string | null | undefined)[]) {
  if (hasPaymentTalk(...texts)) throw new Error(PAYMENT_NOTE);
}
