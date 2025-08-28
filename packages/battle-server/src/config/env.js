// packages/battle-server/src/config/env.js
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

// .env는 패키지 루트에 있음 (packages/battle-server/.env)
const ENV_PATH = path.resolve(__dirname, '../../.env');
if (fs.existsSync(ENV_PATH)) dotenv.config({ path: ENV_PATH });
else dotenv.config(); // fallback

const get = (k, d) => (process.env[k] ?? d);

// "300000", "5m", "1h", "30s", "1800000" 등 지원
function parseDuration(v, defMs) {
  if (v == null || v === '') return defMs;
  if (/^\d+$/.test(v)) return parseInt(v, 10); // ms 숫자
  const m = String(v).trim().match(/^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/i);
  if (!m) return defMs;
  const n = parseFloat(m[1]);
  const u = m[2].toLowerCase();
  const mult = (u === 'ms') ? 1 :
               (u === 's')  ? 1000 :
               (u === 'm')  ? 60 * 1000 :
               (u === 'h')  ? 60 * 60 * 1000 :
                              24 * 60 * 60 * 1000; // d
  return Math.max(0, Math.round(n * mult));
}

// "5MB", "500KB", "10M", "1G", "1048576" 등 지원 (기본 1024 단위)
function parseBytes(v, defBytes) {
  if (v == null || v === '') return defBytes;
  if (/^\d+$/.test(v)) return parseInt(v, 10);
  const m = String(v).trim().match(/^(\d+(?:\.\d+)?)(b|kb|k|mb|m|gb|g)$/i);
  if (!m) return defBytes;
  const n = parseFloat(m[1]);
  const u = m[2].toLowerCase();
  const mult = (u === 'b')  ? 1 :
               (u === 'kb' || u === 'k') ? 1024 :
               (u === 'mb' || u === 'm') ? 1024 ** 2 :
               (u === 'gb' || u === 'g') ? 1024 ** 3 : 1;
  return Math.max(0, Math.round(n * mult));
}

// CORS_ORIGIN="*" | "https://a.com, https://b.com"
function parseCorsOrigin(v) {
  if (!v || v === '*') return true; // 모든 오리진 허용
  const parts = v.split(',').map(s => s.trim()).filter(Boolean);
  return parts.length > 1 ? parts : parts[0];
}

const config = {
  env:           get('NODE_ENV', 'development'),
  host:          get('HOST', '0.0.0.0'),
  port:          parseInt(get('PORT', '3001'), 10),
  corsOrigin:    parseCorsOrigin(get('CORS_ORIGIN', '*')),
  jwtSecret:     get('JWT_SECRET', ''),

  cleanupIntervalMs: parseDuration(get('CLEANUP_INTERVAL', '1800000'), 1800000),
  logLevel:          get('LOG_LEVEL', 'info'),

  maxFileSizeBytes:  parseBytes(get('MAX_FILE_SIZE', '5MB'), 5 * 1024 * 1024),
  uploadPath:        path.resolve(process.cwd(), get('UPLOAD_PATH', './uploads')),

  turnTimeoutMs:     parseDuration(get('BATTLE_TURN_TIMEOUT', '300000'), 300000),
  maxPlayersPerBattle: parseInt(get('MAX_PLAYERS_PER_BATTLE', '8'), 10),

  tokenExpiry: {
    participantMs: parseDuration(get('TOKEN_EXPIRY_PARTICIPANT', '1h'), 60 * 60 * 1000),
    spectatorMs:   parseDuration(get('TOKEN_EXPIRY_SPECTATOR', '30m'), 30 * 60 * 1000),
  },
};

module.exports = config;
