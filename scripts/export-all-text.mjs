// Export editorial text, not JavaScript. Run npm run build first.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import vm from 'node:vm';
const output = process.argv[2] || '/home/enan/clawd/exports/braille-pathfinder-all-text.md';
const server = spawn('python3', ['-m', 'http.server', '4179', '--bind', '127.0.0.1', '--directory', 'dist'], {stdio:'ignore'});
const browser = await chromium.launch({headless:true});
try {
  await new Promise(r=>setTimeout(r,700));
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:4179/');
  await page.locator('#appTools').waitFor();
  const sections = await page.evaluate(() => {
    const parts=[];
    function add(title,text){parts.push(`## ${title}\n\n${text.trim()}\n`)}
    // Keep link labels AND complete destination URLs, including in hidden sections.
    function text(root){
      const clone=root.cloneNode(true);
      clone.querySelectorAll('noscript').forEach(n=>{const parsed=document.createElement('div');parsed.innerHTML=n.textContent;n.replaceWith(parsed)});
      clone.querySelectorAll('script,style').forEach(n=>n.remove());
      clone.querySelectorAll('a[href]').forEach(n=>n.textContent+=` (${n.getAttribute('href')})`);
      clone.querySelectorAll('br').forEach(n=>n.replaceWith('\n'));
      clone.querySelectorAll('p,h1,h2,h3,h4,li,dt,dd,label,legend,summary,button,option,pre,caption,tr,section,fieldset,div').forEach(n=>{n.prepend('\n');n.append('\n')});
      return clone.textContent.replace(/[\t ]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim();
    }
    const initial=document.querySelector('.wrap').cloneNode(true);
    initial.querySelector('#appTools').remove();
    add('Static guide, form labels, options, headings, rights, prices, and legal notice',text(initial));
    add('Skip link',document.querySelector('.skip').textContent);
    const labels=[...document.querySelectorAll('[aria-label]')].map(el=>el.getAttribute('aria-label'));
    add('Accessibility-only region and control labels', [...new Set(labels)].join('\n'));
    add('Page title and search description',document.title+'\n'+document.querySelector('meta[name="description"]').content);
    add('Document checklist — all items, including conditional items',DOCS.map(d=>`### ${d.t}\n\n${d.w}\n\nShown for: ${d.who.map(k=>PATHWAYS[k].name).join('; ')}.${d.sit?' Situation: '+d.sit+'.':''}${d.cond?' Additional condition: '+({ssa:'receives SSI or SSDI',notssa:'does not receive SSI or SSDI',veteran:'veteran',deafblind:'combined hearing and vision loss'}[d.cond])+'.':''}`).join('\n\n'));
    add('All programs and workflows — time labels are estimates unless a legal deadline is cited',Object.entries(PATHWAYS).map(([k,p])=>`### ${p.name}\n\n${p.tag}\n\n${p.blurb}\n\n`+p.steps(STATES.find(s=>s.kind==='blind')).map((st,i)=>`${i+1}. ${st.when} — ${st.t}\n\n${st.d}`).join('\n\n')).join('\n\n'));
    add('VR first-step variant — state with a combined VR agency',PATHWAYS.vr.steps(STATES.find(s=>s.kind==='combined'))[0].d);
    for(const st of STATES){render({st,sit:'work',veteran:true,deafblind:true,ssa:true});add(`${st.n} — all agency and federal contact content`,text(document.getElementById('agencyCards')))}
    // Exhaustively enumerate 4 situations × 8 option combinations; deduplicate identical blocks.
    const seen=new Set();
    for(const sit of ['work','student','older','reading']) for(let flags=0;flags<8;flags++){
      const f={st:STATES.find(s=>s.c==='CA'),sit,veteran:!!(flags&1),deafblind:!!(flags&2),ssa:!!(flags&4)};
      render(f);
      const blocks=[];
      for(const id of ['pathIntro','pathways','stepsIntro','phoneScript','eyeScript','schoolScript','appealScript','status','docProgress']){
        if(id==='schoolScript'&&sit!=='student')continue;
        const value=text(document.getElementById(id));
        if(!seen.has(value)){seen.add(value);blocks.push(`### ${id} (reader-facing text)\n\n${value}`)}
      }
      if(blocks.length)add(`Conditional rendered variants: ${sit}; veteran ${f.veteran?'yes':'no'}; hearing loss ${f.deafblind?'yes':'no'}; SSI/SSDI ${f.ssa?'yes':'no'}`,blocks.join('\n\n'));
    }
    add('Template substitutions and visibility','California is the example state in the conditional variants above. State names and agency names are replaced with the selected state’s entries listed in the contact sections. Agency names in letters omit parenthetical abbreviations. School requests appear only for students. Optional federal contacts appear for veterans and people with combined hearing and vision loss. Program ordering changes with the form answers; the first program is labelled “Start here:”. Checklist progress uses the number checked and the number shown.');
    for(let i=0;i<4;i++){textStep=i;applyText();add('Text size status — level '+i,document.getElementById('textSizeNote').textContent)}
    document.getElementById('appDate').value='2026-01-01';updateDeadlines(false);
    add('Deadline output — example application signed January 1, 2026',text(document.getElementById('deadlineOut')));
    add('Deadline substitutions','Dates change with the application date and browser locale. Eligibility is calculated at 60 calendar days; the example IPE date is calculated at 150 calendar days (90 days after a day-60 eligibility decision). The suggested check-in is 30 calendar days. These calculations and their qualifications are unchanged.');
    add('Offline, install, and notification controls and privacy notice',text(document.getElementById('appTools')));
    const copyButtons=[...document.querySelectorAll('button')].filter(b=>b.textContent.startsWith('Copy '));
    add('Successful copy announcements',copyButtons.map(b=>b.textContent.replace(/^Copy /,'Copied ')+' to clipboard.').join('\n'));
    add('Copied checklist format','Braille display paperwork checklist for [selected state] ([selected situation])\n\nEach visible checklist item includes its full title and explanation, preceded by [x] if checked or [ ] if unchecked.\n\nAgency: [agency name], [department]. [full website URL] [phone, if listed]');
    return {parts,states:STATES.length,docs:DOCS.length,programs:Object.keys(PATHWAYS).length};
  });
  // Collect every prose string literal in the message-producing code. This includes
  // ternary branches and catch/error paths that cannot all be triggered in one run.
  function literals(source){
    const values=[];
    const pattern=/"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g;
    for(const m of source.matchAll(pattern)){
      let value;try{value=vm.runInNewContext(m[0])}catch{continue}
      if(typeof value==='string' && /[a-z]{2} [a-z]{2}/i.test(value) && !/[<>{}=;]|position:|querySelector|\^/.test(value) && !['card key','sr-only ext','use strict','Missing subscription ownership record','unsubscribe failed','not configured','Uncacheable shell asset: ','Navigation unavailable'].includes(value))values.push(value);
    }
    return [...new Set(values)];
  }
  const source=readFileSync('src/index.html','utf8');
  const runtime=source.slice(source.indexOf('// ----- Helpers -----'));
  const enhancements=readFileSync('app-enhancements.js','utf8');
  sections.parts.push('## Conditional status, validation, clipboard, storage, and notification messages\n\nThese messages appear only when the corresponding action, permission, connection, or error state occurs. Fragments such as “, a veteran” are combined into the personalized introduction shown above. Technical identifiers and internal-only diagnostics are omitted.\n\n'+[...new Set([...literals(runtime),...literals(enhancements)])].map(s=>'- '+s.replace(/\n/g,' / ')).join('\n')+'\n');
  // Render offline fallback without styles or markup.
  await page.goto('http://127.0.0.1:4179/offline.html');
  sections.parts.push('## Offline fallback page\n\n'+await page.title()+'\n\n'+await page.locator('main').innerText()+'\n\nTry opening the guide again: /\n');
  const manifest=JSON.parse(readFileSync('public/manifest.webmanifest','utf8'));
  sections.parts.push(`## Install metadata\n\nName: ${manifest.name}\n\nShort name: ${manifest.short_name}\n\nDescription: ${manifest.description}\n`);
  sections.parts.push('## Service worker: notification and last-resort offline text\n\n'+literals(readFileSync('public/sw.js','utf8')).map(s=>'- '+s).join('\n')+'\n');
  const body='# Braille Display Pathfinder — all user-facing text\n\nEditorial export of the updated local site. Generated from source data, static markup, and all 32 form combinations. Full contact content covers 50 states and the District of Columbia. Conditional blocks are deduplicated; their headings identify the first combination that produces them. No program eligibility or contact information was independently reverified for this editorial export.\n\n'+sections.parts.join('\n');
  // Completeness checks: every program, document, and every state data field.
  // Data is available from a fresh guide page, not the separate offline document.
  await page.goto('http://127.0.0.1:4179/');
  const expected=await page.evaluate(()=>[...STATES.flatMap(s=>[s.n,s.agency,s.dept,s.unit,s.url,s.phone,s.at,s.atUrl].filter(Boolean)),...DOCS.flatMap(d=>[d.t,d.w]),...Object.values(PATHWAYS).flatMap(p=>[p.name,p.tag,p.blurb])]);
  for(const value of expected)if(!body.includes(value))throw new Error('Export missing text: '+value);
  mkdirSync(output.slice(0,output.lastIndexOf('/')),{recursive:true});
  writeFileSync(output,body);
  console.log(`Export verified: ${sections.states} jurisdictions, ${sections.docs} checklist items, ${sections.programs} programs, 32 form combinations; ${Buffer.byteLength(body)} bytes.\n${output}`);
} finally {await browser.close();server.kill()}
