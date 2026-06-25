export const CAMPAIGN_DELAY_MIN_SECONDS = 30;
export const CAMPAIGN_DELAY_MAX_SECONDS = 60;
export const CAMPAIGN_COOLDOWN_EVERY = 5;
export const CAMPAIGN_COOLDOWN_MINUTES = 5;

export function getRandomCampaignDelayMs() {
  const spread = CAMPAIGN_DELAY_MAX_SECONDS - CAMPAIGN_DELAY_MIN_SECONDS + 1;
  return (CAMPAIGN_DELAY_MIN_SECONDS + Math.floor(Math.random() * spread)) * 1000;
}

export function getCampaignCooldownMs() {
  return CAMPAIGN_COOLDOWN_MINUTES * 60 * 1000;
}

export function getCampaignEngineLabel() {
  return `Delay aleatorio de ${CAMPAIGN_DELAY_MIN_SECONDS}–${CAMPAIGN_DELAY_MAX_SECONDS}s e pausa de ${CAMPAIGN_COOLDOWN_MINUTES} min a cada ${CAMPAIGN_COOLDOWN_EVERY} envios.`;
}
