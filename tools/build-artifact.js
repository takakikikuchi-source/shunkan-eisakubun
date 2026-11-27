// claude.ai の非公開ページ用に、HTML と CSS・JS を1ファイルにまとめる
// 使い方: node tools/build-artifact.js [入力HTML（既定: coach/index.html）]
//   → dist/shunkan-eisakubun.html（このファイルを Claude に同じ URL へ公開し直してもらう）
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const input = path.join(root, process.argv[2] || 'coach/index.html');
const dir = path.dirname(input);
const read = (p) => fs.readFileSync(path.join(dir, p), 'utf8');
const html = fs.readFileSync(input, 'utf8');

const title = (html.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '瞬間英作文';
const css = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((m) => read(m[1])).join('\n');
const bodyMatch = html.match(/<body([^>]*)>([\s\S]*)<\/body>/);
let body = bodyMatch[2];
// 公開時は body タグが自動で付くので、body の class はスクリプトで付け直す
const bodyClass = (bodyMatch[1].match(/class="([^"]*)"/) || [])[1];
if (bodyClass) body = `<script>document.body.className = ${JSON.stringify(bodyClass)};</script>\n` + body;
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
console.log(path.relative(root, input), '→ dist/shunkan-eisakubun.html', out.length, 'bytes');
