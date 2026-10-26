import { db, migrate } from '../src/db.js';
import { PGlite } from '@electric-sql/pglite';
export async function database(){
 if(process.env.DATABASE_URL&&!new URL(process.env.DATABASE_URL).pathname.endsWith('_test'))throw new Error('Tests require a dedicated database name ending _test.');
 let stop=async()=>db.end();
 if(!process.env.DATABASE_URL){
  const p=new PGlite();
  const query=async(text,values)=>{
   const result=values?await p.query(text,values):/;\s*\S/.test(text.trim().replace(/;$/,''))?(await p.exec(text)).at(-1):await p.query(text);
   return {...result,rowCount:result.rows?.length||result.affectedRows||0};
  };
  db.query=query;db.connect=async()=>({query,release(){}});stop=async()=>p.close();
 }
 process.env.TELEGRAM_ADMIN_IDS='1';await migrate();return {db,stop};
}
