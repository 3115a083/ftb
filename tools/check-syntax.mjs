import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
for(const directory of ['src','test','tools','public'])for(const file of await readdir(new URL('../'+directory+'/',import.meta.url))){
 if(!/\.(js|mjs)$/.test(file))continue;
 const result=spawnSync(process.execPath,['--check',directory+'/'+file],{stdio:'inherit'});if(result.status)process.exit(result.status);
}
