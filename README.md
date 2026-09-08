# Ichijo AI Lab Admin

Ichijo AI Lab閲覧サイトとは別に運用する管理者専用サイトです。パスワードだけでログインし、アプリ、画像付きブログ、問い合わせを管理できます。

## Supabase設定

SupabaseのSQL Editorで `supabase-setup.sql` を全て実行してください。初回設定後に再実行してもよい内容になっています。ブログ画像はSupabase Storageの `blog-images` バケットへ保存され、JPG・PNG・WebP・GIF（各5MBまで）に対応します。

ログイン画面にメールアドレスは表示しませんが、認証と権限判定には `assets/config.js` の管理者メールアドレスを内部で使用します。パスワードはソースコードに保存されません。
