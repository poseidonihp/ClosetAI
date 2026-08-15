import { generateKeyPairSync } from 'node:crypto';

const rsaModulusLength = 2048;

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: rsaModulusLength,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const privateKeyBase64 = Buffer.from(privateKey).toString('base64');

process.stdout.write(
  [
    '# Pega esta línea en apps/backend/.env',
    '# (la clave pública se deriva automáticamente al iniciar el backend)',
    `RSA_PRIVATE_KEY_B64=${privateKeyBase64}`,
    '',
  ].join('\n'),
);
