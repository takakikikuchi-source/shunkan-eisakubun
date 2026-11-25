// claude.ai の非公開ページ用に、index.html と CSS・JS を1ファイルにまとめる
// 使い方: node tools/build-artifact.js  →  dist/shunkan-eisakubun.html
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const html = read('index.html');

const title = (html.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '瞬間英作文';
const css = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((m) => read(m[1])).join('\n');
let body = html.match(/<body>([\s\S]*)<\/body>/)[1];
body = body.replace(/<script src="([^"]+)"><\/script>/g,
  (m, p) => '<script>\n' + read(p).replace(/<\/script/gi, '<\\/script') + '</script>');

const out = `<title>${title}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
${css}</style>
${body.trim()}
`;

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'shunkan-eisakubun.html'), out);
console.log('dist/shunkan-eisakubun.html', out.length, 'bytes');
