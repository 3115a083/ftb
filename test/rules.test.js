import test from 'node:test';
import assert from 'node:assert/strict';
import { rankPeople, csvCell } from '../src/rules.js';
import { telegramToHtml } from '../src/page-settings.js';
test('win-rate uses only eligible players and keeps identical rates tied',()=>{
 const rows=rankPeople([{name:'A',played:3,wins:2,metrics:{}},{name:'B',played:6,wins:4,metrics:{}},{name:'C',played:1,wins:1,metrics:{}}],3,[]);
 assert.deepEqual(rows.map(x=>[x.name,x.place]),[['A',1],['B',1],['C',null]]);
});
test('missing penalties never become a better measured zero',()=>{
 const rows=rankPeople([{name:'A',played:3,wins:2,metrics:{received:null}},{name:'B',played:3,wins:2,metrics:{received:2}}],3,['received']);
 assert.equal(rows[0].place,rows[1].place);
});
test('CSV escapes formula prefixes, quotes and newlines',()=>{
 for(const value of ['=SUM(A1)',' +cmd','@foo','\t=1'])assert.match(csvCell(value),/^"'/);
 assert.equal(csvCell('O"Neil\nTwo'),'"O""Neil\nTwo"');
});
test('rules preserve formatting without active HTML or unsafe links',()=>{
 assert.equal(telegramToHtml('<script>',[{offset:0,length:8,type:'bold'}]),'<strong>&lt;script&gt;</strong>');
 assert.equal(telegramToHtml('click',[{offset:0,length:5,type:'text_link',url:'javascript:alert(1)'}]),'click');
 assert.match(telegramToHtml('click',[{offset:0,length:5,type:'text_link',url:'https://example.org/"'}]),/&quot;/);
});
