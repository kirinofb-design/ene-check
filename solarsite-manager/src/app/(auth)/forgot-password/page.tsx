export default function ForgotPasswordPage() {
  return (
    <div className="max-w-md mx-auto">
      <h1 className="text-xl font-semibold mb-4">パスワードリセット申請</h1>
      <p className="text-sm text-slate-400 mb-6">
        Spec.md セクション 6.1 の `/auth/forgot-password` に対応する画面です。
        パスワードリセットメール送信処理は将来の実装対象です。
      </p>
      <div className="rounded-md border border-dashed border-slate-700 p-4 text-xs text-slate-500">
        メールアドレス入力フォームと、PasswordResetToken を使ったフローを今後追加します。
      </div>
    </div>
  );
}

