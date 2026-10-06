export type DemoAccount = {
  roleId: string;
  label: string;
  description: string;
  email: string;
  password: string;
  futureModule: boolean;
};

export function resolveDemoAccount(accounts: DemoAccount[], roleId: string) {
  if (!roleId) return null;
  return accounts.find((account) => account.roleId === roleId) ?? null;
}
