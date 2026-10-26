import PDFDocument from 'pdfkit';
import { db } from './db.js';
import { standings } from './tournament.js';

function dataImage(value) {
  if (!value?.startsWith('data:image/')) return null;
  const comma = value.indexOf(',');
  if (comma < 0) return null;
  try { return Buffer.from(value.slice(comma + 1), 'base64'); } catch { return null; }
}

function collect(doc, draw) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (x) => chunks.push(x));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    draw();
    doc.end();
  });
}

function decodeHtml(s) {
  return String(s)
    .replaceAll('&lt;', '<').replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"').replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&');
}

function drawFormattedRules(doc, html) {
  const tokens = String(html || '').split(/(<\/?(?:strong|b|em|i|u|s|code|pre|a)(?:\s+href="[^"]*")?>|<br\s*\/?>)/gi);
  const style = { bold: false, italic: false, underline: false, strike: false, code: false };
  for (const token of tokens) {
    if (!token) continue;
    const lower = token.toLowerCase();
    if (lower.startsWith('<br')) { doc.text('\n', { continued: true }); continue; }
    if (lower === '<strong>' || lower === '<b>') { style.bold = true; continue; }
    if (lower === '</strong>' || lower === '</b>') { style.bold = false; continue; }
    if (lower === '<em>' || lower === '<i>') { style.italic = true; continue; }
    if (lower === '</em>' || lower === '</i>') { style.italic = false; continue; }
    if (lower === '<u>') { style.underline = true; continue; }
    if (lower === '</u>') { style.underline = false; continue; }
    if (lower === '<s>') { style.strike = true; continue; }
    if (lower === '</s>') { style.strike = false; continue; }
    if (lower === '<code>' || lower === '<pre>') { style.code = true; continue; }
    if (lower === '</code>' || lower === '</pre>') { style.code = false; continue; }
    if (/^<\/?a/i.test(token)) continue;

    let font = 'Helvetica';
    if (style.code) font = 'Courier';
    else if (style.bold && style.italic) font = 'Helvetica-BoldOblique';
    else if (style.bold) font = 'Helvetica-Bold';
    else if (style.italic) font = 'Helvetica-Oblique';
    doc.font(font).fontSize(10.5).text(decodeHtml(token), {
      continued: true,
      underline: style.underline,
      strike: style.strike,
      lineGap: 3,
    });
  }
  doc.text('');
}

function drawHeader(doc, settings, subtitle) {
  const logo = dataImage(settings.logo);
  if (logo) {
    try { doc.image(logo, 42, 38, { fit: [72, 72] }); } catch { /* invalid image ignored */ }
  }
  const x = logo ? 128 : 42;
  doc.font('Helvetica-Bold').fontSize(22).fillColor('#111').text(settings.title, x, 42, { width: 420 });
  if (settings.description) doc.font('Helvetica').fontSize(10).fillColor('#555').text(settings.description, x, doc.y + 4, { width: 420 });
  doc.font('Helvetica-Bold').fontSize(13).fillColor('#111').text(subtitle, 42, Math.max(doc.y + 24, 122));
  doc.moveTo(42, doc.y + 5).lineTo(553, doc.y + 5).strokeColor('#dddddd').stroke();
  doc.moveDown(1.3);
}

export async function rulesPdf() {
  const s = (await db.query('SELECT * FROM settings WHERE id=1')).rows[0];
  const d = new PDFDocument({ size: 'A4', margin: 42, info: { Title: `${s.title} - Regelwerk` } });
  return collect(d, () => {
    drawHeader(d, s, 'Regelwerk');
    if (!s.rules) d.font('Helvetica').fontSize(11).fillColor('#555').text('Das Regelwerk wurde noch nicht veröffentlicht.');
    else if (s.rules_html) drawFormattedRules(d, s.rules_html);
    else d.font('Helvetica').fontSize(10.5).fillColor('#111').text(s.rules, { lineGap: 3 });
    d.moveDown(2).fontSize(8).fillColor('#777').text(`Erstellt mit FTB · ${new Date().toLocaleDateString('de-DE')}`, { align: 'center' });
  });
}

export async function tournamentPdf() {
  const s = (await db.query('SELECT * FROM settings WHERE id=1')).rows[0];
  if (!s.tournament_finished || !s.winner_team_id) throw new Error('tournament_not_finished');
  const tables = await standings();
  const games = (await db.query(`SELECT g.*,h.name home,a.name away,w.name winner
    FROM games g JOIN teams h ON h.id=g.home_team_id JOIN teams a ON a.id=g.away_team_id
    LEFT JOIN teams w ON w.id=g.winner_team_id WHERE NOT g.is_demo
    ORDER BY CASE g.phase WHEN 'group' THEN 1 WHEN 'knockout' THEN 2 ELSE 3 END,g.round_no NULLS FIRST,g.slot_no NULLS FIRST,g.id`)).rows;
  const winner = (await db.query('SELECT name FROM teams WHERE id=$1', [s.winner_team_id])).rows[0]?.name || 'Sieger';
  const d = new PDFDocument({ size: 'A4', margin: 42, info: { Title: `${s.title} - Turnierbericht` } });
  return collect(d, () => {
    drawHeader(d, s, 'Turnierbericht');
    d.font('Helvetica-Bold').fontSize(16).fillColor('#111').text(`Turniersieger: ${winner}`).moveDown();
    d.fontSize(17).text('Gruppentabellen').moveDown(.5);
    for (const g of tables) {
      if (d.y > 650) d.addPage();
      d.font('Helvetica-Bold').fontSize(13).text(`Gruppe ${g.group}`);
      d.font('Courier').fontSize(8.5).text('Platz   Team                              Spiele   Siege   Niederlagen');
      d.moveDown(.2);
      for (const t of g.teams) {
        const place = t.disqualified ? 'DQ' : `${t.place}.`;
        const name = `${t.disqualified ? '[DQ] ' : ''}${t.name}`;
        d.text(`${place.padEnd(7)} ${name.slice(0, 32).padEnd(34)} ${String(t.played).padStart(6)}   ${String(t.wins).padStart(5)}   ${String(t.losses).padStart(11)}`);
      }
      d.moveDown();
    }
    d.addPage();
    d.font('Helvetica-Bold').fontSize(17).text('Spielplan und Ergebnisse').moveDown(.5);
    for (const g of games) {
      if (d.y > 740) d.addPage();
      const result = g.status === 'finished' && g.winner ? `Sieger: ${g.winner}` : g.status === 'live' ? 'läuft' : g.status === 'cancelled' ? 'abgesagt' : 'offen';
      d.font('Helvetica').fontSize(10).text(`${g.round_label || g.group_name || g.phase} | ${g.home} vs. ${g.away} | ${result}`);
    }
    const ko = games.filter((g) => g.phase === 'knockout');
    if (ko.length) {
      d.addPage();
      d.font('Helvetica-Bold').fontSize(17).text('K.-o.-Spielbaum').moveDown(.5);
      for (const g of ko) d.font('Helvetica').fontSize(10).text(`${g.round_label || 'K.-o.'}: ${g.home} vs. ${g.away}${g.winner ? ` | Sieger: ${g.winner}` : ''}`);
    }
  });
}

export async function statisticsPdf(stats) {
 const { METRICS } = await import('./rules.js');
 const { existsSync } = await import('node:fs');
 const d=new PDFDocument({size:'A4',layout:'landscape',margin:36,info:{Title:`${stats.session.name} - Turbo-Statistik`}});
 const font=['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf','/usr/share/fonts/ttf-dejavu/DejaVuSans.ttf','/usr/share/fonts/dejavu/DejaVuSans.ttf'].find(existsSync);
 if(font)d.registerFont('Stats',font);
 const face=font?'Stats':'Helvetica';
 return collect(d,()=>{
  const keys=stats.session.metrics,base=[{label:'Platz',width:35},{label:'Person',width:160},{label:'Spiele',width:40},{label:'Siege',width:40},{label:'Quote',width:55}];
  const remaining=d.page.width-72-base.reduce((n,x)=>n+x.width,0);
  const columns=[...base,...keys.map(k=>({label:METRICS[k].label,width:remaining/Math.max(1,keys.length)}))];
  let page=0;
  function header(){page++;d.font(face).fillColor('#122d26').fontSize(16).text(stats.session.name,36,32,{width:730,height:44,ellipsis:true});
   d.fontSize(9).fillColor('#475569').text(`Turbo-Statistik | Nur freigegebene Spiele | Mindestspielzahl: ${stats.session.min_games}`,36,80);
   d.text('Leere Werte: nicht erfasst. Runden bis leer: Durchschnitt erfasster Abschlüsse.',36,96);
   let x=36;for(const col of columns){d.rect(x,120,col.width,42).fill('#e6efe9');d.fillColor('#173e32').fontSize(9).text(col.label,x+5,127,{width:col.width-10,height:32});x+=col.width;}
   d.fontSize(8).fillColor('#64748b').text(`Seite ${page}`,36,d.page.height-28,{lineBreak:false});d.y=162;
  }
  header();
  for(const [index,row] of [...stats.rows,stats.guests].entries()){
   if(d.y> d.page.height-90){d.addPage();header();}
   const y=d.y,height=44,name=row.name+(row.is_guest?' (Einsätze)':row.qualified?'':` (${row.played}/${stats.session.min_games}, ungewertet)`);
   const cells=[row.place??'-',name,row.played,row.wins,row.is_guest||row.win_rate==null?'-':(row.win_rate*100).toFixed(1)+'%',...keys.map(k=>row.metrics[k]==null?'-':Number(row.metrics[k].toFixed(2)))];
   let x=36;
   for(let i=0;i<columns.length;i++){const col=columns[i];d.rect(x,y,col.width,height).fill(row.is_guest?'#e6efe9':index%2?'#f3f6f8':'#ffffff');d.font(face).fontSize(9).fillColor('#17202a').text(String(cells[i]),x+5,y+8,{width:col.width-10,height:height-12});x+=col.width;}
   d.y=y+height;
  }
  if(d.y>d.page.height-80){d.addPage();header();}
  d.font(face).fontSize(8).fillColor('#475569').text('Gäste werden gemeinsam ausgewiesen und erhalten keinen persönlichen Rang. Ihre Messwerte fließen nicht in Teamstatistiken ein.',36,d.y+15,{width:730});
 });
}
