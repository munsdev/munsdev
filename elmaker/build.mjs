/* Build: three source files become the one page the Worker serves.
   node build.mjs
   Writes worker/src/page.html, which the Worker compiles into its bundle.
   There is no offline copy: the app needs the server now, so a file you
   could open from disk would only be a trap. */
import fs from 'fs';

const shell = fs.readFileSync('shell.html', 'utf8');
const fonts = fs.readFileSync('embedded-fonts.css', 'utf8');
const app   = fs.readFileSync('app.js', 'utf8');

if (!shell.includes('/*FONTS*/')) throw new Error('shell.html has no /*FONTS*/ placeholder');
if (!shell.includes('/*APP*/'))   throw new Error('shell.html has no /*APP*/ placeholder');

const out = shell.replace('/*FONTS*/', () => fonts).replace('/*APP*/', () => app);

fs.writeFileSync('worker/src/page.html', out);

console.log('built ' + (out.length / 1024).toFixed(0) + 'KB -> worker/src/page.html');
