interface ResetPasswordPageProps {
  params: { token: string };
}

export default function ResetPasswordPage({ params }: ResetPasswordPageProps) {
  return (
    <div className="max-w-md mx-auto">
      <h1 className="text-xl font-semibold mb-4">パスワード再設定</h1>
      <p className="text-sm text-slate-400 mb-6">
        URL トークン ({params.token}) を用いて PasswordResetToken を検証し、
        新しいパスワードを設定する画面を今後ここに実装します。
      </p>
      <div className="rounded-md border border-dashed border-slate-700 p-4 text-xs text-slate-500">
        Spec.md セクション 6.1 `/auth/reset-password/:token` および 4.3 の認証ルールに準拠します。
      </div>
    </div>
  );
}

