/** 表单校验工具: 与 antd Form rules 配合使用 */

export const required = (label: string) => ({
  required: true,
  message: `请输入${label}`,
});

export const minLength = (label: string, n: number) => ({
  min: n,
  message: `${label}至少 ${n} 个字符`,
});

export const maxLength = (label: string, n: number) => ({
  max: n,
  message: `${label}不能超过 ${n} 个字符`,
});

export const usernameRule = [
  { required: true, message: '请输入用户名' },
  { pattern: /^[a-zA-Z0-9_]{2,32}$/, message: '仅支持字母、数字、下划线,2-32 位' },
];

export const passwordRule = [
  { required: true, message: '请输入密码' },
  { min: 6, message: '密码至少 6 位' },
];

export const emailRule = { type: 'email' as const, message: '邮箱格式不正确' };

export function isHttpError409(err: any): boolean {
  return err?.status === 409 || err?.code === 4090;
}
