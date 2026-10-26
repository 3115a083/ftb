import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
// New HTML requests new assets after an update without clearing saved favorites.
export const assetVersion=createHash('sha256').update(Buffer.concat(['site.css','site.js','theme.js'].map(name=>readFileSync(new URL('../public/'+name,import.meta.url))))).digest('hex').slice(0,16);
