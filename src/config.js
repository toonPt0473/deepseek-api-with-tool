import dotenv from 'dotenv';
dotenv.config();

export const RATE_LIMIT_PER_MINUTE = parseInt(process.env.RATE_LIMIT_PER_MINUTE || '30', 10);

const interactiveRaw = (process.env.SERVER_INTERACTIVE_LOGIN || '1').toLowerCase();
export const SERVER_INTERACTIVE_LOGIN = !['0', 'false', 'no', 'off'].includes(interactiveRaw);

export const MODEL_MAP = {
  'deepseek-chat': 'default',   // Instant — the fast default model
  'deepseek-expert': 'expert',  // Expert  — the stronger, slower model
};

export const DEFAULT_MODEL = 'deepseek-chat';

export const DEFAULT_THINKING = ['1', 'true', 'yes', 'on'].includes(
  (process.env.DEFAULT_THINKING || 'false').toLowerCase()
);

export const DEFAULT_SEARCH = ['1', 'true', 'yes', 'on'].includes(
  (process.env.DEFAULT_SEARCH || 'false').toLowerCase()
);

export const HOST = process.env.HOST || '127.0.0.1';
export const PORT = parseInt(process.env.PORT || '8000', 10);

export function isKnownModel(name) {
  return Object.prototype.hasOwnProperty.call(MODEL_MAP, name);
}

export function resolveModelType(name) {
  if (!isKnownModel(name)) {
    throw new Error(`Unknown model name: ${name}`);
  }
  return MODEL_MAP[name];
}
