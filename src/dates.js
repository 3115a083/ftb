import { requireThat } from './rules.js';
export function dateIso(value){return String(value instanceof Date?value.toISOString():value||'').slice(0,10);}
export function displayDate(value){const v=dateIso(value);return /^\d{4}-\d{2}-\d{2}$/.test(v)?`${v.slice(8,10)}.${v.slice(5,7)}.${v.slice(2,4)}`:'';}
export function parseDate(value){let v=String(value||'').trim();const m=/^(\d{2})\.(\d{2})\.(\d{2}|\d{4})$/.exec(v);if(m)v=`${m[3].length===2?'20'+m[3]:m[3]}-${m[2]}-${m[1]}`;requireThat(/^\d{4}-\d{2}-\d{2}$/.test(v)&&!isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v,'Datum als DD.MM.YY eingeben, z. B. 27.10.26.');return v;}
