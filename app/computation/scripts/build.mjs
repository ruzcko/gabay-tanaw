// Node 24's bundled TypeScript eraser emits browser-native modules. No runtime dependencies.
import { stripTypeScriptTypes } from 'node:module';
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
const source = new URL('../src/',import.meta.url), output=new URL('../dist/',import.meta.url);
async function build(source,output) {
await mkdir(output,{recursive:true});
for(const name of await readdir(source,{withFileTypes:true})) {
  if(name.isDirectory()){await build(new URL(`${name.name}/`,source),new URL(`${name.name}/`,output));continue;}
  const file=name.name;
  if(!file.endsWith('.ts')) continue;
  const js=stripTypeScriptTypes((await readFile(new URL(file,source),'utf8')).replace(/\r\n/g,'\n'))
    .replace(/(from\s+['"]\.\.?\/[^'"]+)\.ts(['"])/g,'$1.js$2')
    .replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n');
  await writeFile(new URL(file.replace(/\.ts$/,'.js'),output),js.trimEnd() + '\n');
}
}
await build(source,output);
console.log('Built browser-safe and server modules in dist/ (separate entry points).');
