// Reads settings from the environment (and from a local .env file if present).

try {
  process.loadEnvFile();
} catch {
  // No .env file: fine, use the real environment.
}

const env = process.env;

export const config = {
  port: Number(env.PORT) || 3000,

  anthropicApiKey: env.ANTHROPIC_API_KEY || '',
  model: env.RIDETASTE_MODEL || 'claude-opus-5-5',

  qlooApiKey: env.QLOO_API_KEY || '',
  // Qloo gives hackathon teams their own base URL with the API key.
  // Check the email or Devpost page that came with your key.
  qlooBaseUrl: (env.QLOO_BASE_URL || 'https://hackathon.api.qloo.com').replace(/\/+$/, ''),

  // Public OpenStreetMap services. Both have fair-use limits, so keep traffic low.
  routingUrl: (env.ROUTING_URL || 'https://routing.openstreetmap.de/routed-bike').replace(/\/+$/, ''),
  geocodeUrl: (env.GEOCODE_URL || 'https://nominatim.openstreetmap.org').replace(/\/+$/, ''),
  contactEmail: env.CONTACT_EMAIL || '',
};

/** True when real Qloo data is available; otherwise the app runs on sample data. */
export function qlooIsLive() {
  return Boolean(config.qlooApiKey);
}

/** True when the Claude agent can run; otherwise only the quick-plan form works. */
export function agentIsAvailable() {
  return Boolean(config.anthropicApiKey);
}
