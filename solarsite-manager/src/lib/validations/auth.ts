import { z } from "zod";

/**
 * パスワードルール（Spec 4.3）: 8〜128文字、英字1文字以上＋数字1文字以上
 */
export const passwordSchema = z
  .string()
  .min(8, "8文字以上で入力してください")
  .max(128, "128文字以内で入力してください")
  .regex(/[A-Za-z]/, "英字を1文字以上含めてください")
  .regex(/[0-9]/, "数字を1文字以上含めてください");

export const signupSchema = z.object({
  email: z.string().email("有効なメールアドレスを入力してください"),
  name: z.string().max(100).optional(),
  password: passwordSchema,
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, "パスワードを入力してください"),
});
