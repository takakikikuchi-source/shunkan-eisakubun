# 瞬間英作文ツール

日本語の文を見て、英文をタイピングで答える練習ツール。要件は [docs/requirements.md](docs/requirements.md)。

## 公開ページ（GitHub Pages）

https://takakikikuchi-source.github.io/shunkan-eisakubun/

- `main` ブランチに push すると1〜2分で反映される
- スマホ（Android Chrome）ではメニューの「ホーム画面に追加」でアプリとして使える。一度開けばオフラインでも動く
- 更新は「次に開いたとき」に反映される（1回目は前の版が表示される）
- ファイルを追加したら `sw.js` の `FILES` にも追加し、`CACHE` の番号を上げる

## 使い方（PC）

`index.html` をダブルクリックして Chrome / Edge で開く。

- 英文を入力して **Enter** で判定、もう一度 **Enter** で次の問題へ
- 判定が厳しすぎるときは「これも正解」で、自分の答えを別解として登録できる（このブラウザ内に保存）

## 非公開ページ（claude.ai）

https://claude.ai/artifact/U215EKywUtD9yfo1jsQ2w9 （自分のアカウントでログインしたときだけ開ける。スマホからも使える）

更新するときは `node tools/build-artifact.js` で `dist/shunkan-eisakubun.html` を作り直し、Claude に同じファイルを公開し直してもらう（URL はそのまま）。

## 構成

| パス | 内容 |
|---|---|
| `index.html` / `css/` / `js/app.js` | 画面 |
| `js/judge.js` | 判定ロジック（短縮形・句読点・別解の扱い、差分表示） |
| `data/*.js` | 問題データ（ユニットごとに1ファイル） |
| `tests/` | 判定ロジックと問題データのテスト（`npm test`） |
