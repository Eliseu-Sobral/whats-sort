export const DEFAULT_CAMPAIGN_GREETINGS = [
  "Oi",
  "Ola",
  "Bom dia",
  "Boa tarde",
  "Boa noite",
];

export const DEFAULT_CAMPAIGN_NAME_FALLBACKS = [
  "amigo",
  "cliente",
  "contato",
];

export const DEFAULT_CAMPAIGN_MESSAGE_VARIANTS = [
  "Se fizer sentido para voce, me responda por aqui.",
  "Posso te explicar melhor em uma mensagem rapida.",
  "Se quiser, sigo com mais detalhes logo em seguida.",
  "Fico a disposicao caso queira continuar.",
];

type PersonalizationSettings = {
  campaign_greetings?: string | null;
  campaign_name_fallbacks?: string | null;
  campaign_message_variants?: string | null;
};

type CampaignContact = {
  name?: string | null;
  phone_number?: string | null;
};

function parseOptions(value: string | null | undefined, defaults: string[]) {
  const items = (value || "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length ? items : defaults;
}

function pickRandom(items: string[]) {
  return items[Math.floor(Math.random() * items.length)] || "";
}

function normalizeName(name: string | null | undefined) {
  return (name || "").trim().replace(/\s+/g, " ");
}

function getFirstName(name: string) {
  return name.split(" ")[0] || "";
}

export function renderCampaignMessage(
  template: string,
  contact: CampaignContact,
  settings: PersonalizationSettings,
) {
  const greetings = parseOptions(settings.campaign_greetings, DEFAULT_CAMPAIGN_GREETINGS);
  const fallbackNames = parseOptions(settings.campaign_name_fallbacks, DEFAULT_CAMPAIGN_NAME_FALLBACKS);
  const messageVariants = parseOptions(settings.campaign_message_variants, DEFAULT_CAMPAIGN_MESSAGE_VARIANTS);

  const resolvedName = normalizeName(contact.name);
  const fallbackName = pickRandom(fallbackNames);
  const finalName = resolvedName || fallbackName;
  const firstName = resolvedName ? getFirstName(resolvedName) : fallbackName;
  const greeting = pickRandom(greetings);
  const variant = pickRandom(messageVariants);
  const hasVariantPlaceholder = /\{\{\s*variacao\s*\}\}/i.test(template);

  let rendered = template
    .replace(/\{\{\s*saudacao\s*\}\}/gi, greeting)
    .replace(/\{\{\s*nome_ou_variavel\s*\}\}/gi, finalName)
    .replace(/\{\{\s*nome\s*\}\}/gi, finalName)
    .replace(/\{\{\s*primeiro_nome\s*\}\}/gi, firstName)
    .replace(/\{\{\s*telefone\s*\}\}/gi, contact.phone_number || "")
    .replace(/\{\{\s*variacao\s*\}\}/gi, variant);

  if (!hasVariantPlaceholder && variant) {
    rendered = `${rendered}\n\n${variant}`;
  }

  return rendered.replace(/\n{3,}/g, "\n\n").trim();
}
