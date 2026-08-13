/**
 * Utility functions for WhatsApp JID normalization and phone number formatting.
 */

/**
 * Normalize any input string (phone number, raw JID, formatted number) to a canonical WhatsApp remoteJid format.
 * Examples:
 * - "+19 079-5416-084630" -> "190795416084630@c.us"
 * - "+62 813-6040-3365" -> "6281360403365@c.us"
 * - "6281360403365@s.whatsapp.net" -> "6281360403365@c.us"
 * - "120363012345678901@g.us" -> "120363012345678901@g.us"
 */
export function normalizeJid(rawJid: string): string {
  if (!rawJid) return '';

  let cleaned = rawJid.trim();

  // If it's a group JID (@g.us) or a linked device ID (@lid), keep it as is
  if (cleaned.endsWith('@g.us') || cleaned.endsWith('@lid')) {
    return cleaned;
  }

  // Replace @s.whatsapp.net or @lid with @c.us if present
  if (cleaned.includes('@s.whatsapp.net')) {
    cleaned = cleaned.replace('@s.whatsapp.net', '@c.us');
  }

  // Strip @c.us suffix temporarily to clean digits
  const hasCus = cleaned.endsWith('@c.us');
  const baseNumber = hasCus ? cleaned.replace('@c.us', '') : cleaned;

  // Remove device ID suffix if present (e.g. :27)
  const baseWithoutDevice = baseNumber.split(':')[0];

  // Remove leading +, spaces, dashes, parentheses
  const digitsOnly = baseWithoutDevice.replace(/\D/g, '');

  return `${digitsOnly}@c.us`;
}

/**
 * Format a canonical remoteJid (or raw phone) into human-friendly phone number format.
 * Example: "6281360403365@c.us" -> "+62 813-6040-3365"
 */
export function formatPhoneNumber(jidOrPhone: string): string {
  if (!jidOrPhone) return '';

  let raw = jidOrPhone.replace(/@c\.us|@g\.us|@s\.whatsapp\.net/g, '').split(':')[0].replace(/\D/g, '');

  if (!raw) return jidOrPhone;

  if (raw.startsWith('62')) {
    return `+62 ${raw.slice(2, 5)}-${raw.slice(5, 9)}-${raw.slice(9)}`;
  }

  if (raw.length >= 10) {
    return `+${raw.slice(0, 2)} ${raw.slice(2, 5)}-${raw.slice(5, 9)}-${raw.slice(9)}`;
  }

  return `+${raw}`;
}
