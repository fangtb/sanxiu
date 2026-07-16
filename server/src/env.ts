import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');
const serverRoot = path.resolve(__dirname, '..');

const envFiles = [
  path.resolve(projectRoot, '.env'),
  path.resolve(serverRoot, '.env'),
  path.resolve(process.cwd(), '.env')
];

for (const envFile of [...new Set(envFiles)]) {
  if (fs.existsSync(envFile)) {
    dotenv.config({ path: envFile, override: false });
  }
}

